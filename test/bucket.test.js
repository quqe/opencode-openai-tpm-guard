import assert from "node:assert/strict"
import test from "node:test"
import { createBucket, observe, release, reserve } from "../dist/bucket.js"

const settings = { safetyMarginTokens: 30_000, maxWaitMs: 300_000, reservationTtlMs: 120_000 }
const noop = () => {}

function fakeTiming(start = 0) {
  let now = start
  const sleeps = []
  return {
    sleeps,
    timing: {
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms)
        now += ms
      },
    },
    advance: (ms) => {
      now += ms
    },
    get now() {
      return now
    },
  }
}

test("a request that fits is reserved immediately", async () => {
  const bucket = createBucket()
  bucket.limit = 1_000_000
  bucket.remaining = 1_000_000
  const { timing, sleeps } = fakeTiming()
  const key = {}

  await reserve(bucket, 200_000, key, undefined, settings, timing, noop)

  assert.equal(sleeps.length, 0)
  assert.equal(bucket.reserved, 200_000)
  assert.equal(bucket.reservations.size, 1)
})

test("a request waits for the token window before it is sent", async () => {
  const bucket = createBucket()
  bucket.limit = 1_000_000
  bucket.remaining = 100_000
  bucket.resetAt = 40_000
  const fake = fakeTiming()
  const timing = {
    now: fake.timing.now,
    sleep: async (ms) => {
      await fake.timing.sleep(ms)
      if (fake.now >= bucket.resetAt) bucket.remaining = bucket.limit
    },
  }

  await reserve(bucket, 200_000, {}, undefined, settings, timing, noop)

  assert.ok(fake.sleeps.length > 0, "expected at least one pause")
  assert.equal(bucket.reserved, 200_000)
})

test("the pause is bounded by maxWaitMs", async () => {
  const bucket = createBucket()
  bucket.limit = 1_000_000
  bucket.remaining = 0
  bucket.resetAt = 3_600_000
  const { timing, sleeps } = fakeTiming()

  await reserve(bucket, 200_000, {}, undefined, { ...settings, maxWaitMs: 5_000 }, timing, noop)

  assert.equal(sleeps.reduce((sum, ms) => sum + ms, 0), 5_000)
  assert.equal(bucket.reserved, 200_000)
})

test("a request larger than the whole window is sent immediately", async () => {
  const bucket = createBucket()
  bucket.limit = 100_000
  bucket.remaining = 100_000
  const { timing, sleeps } = fakeTiming()

  await reserve(bucket, 200_000, {}, undefined, settings, timing, noop)

  assert.equal(sleeps.length, 0)
  assert.equal(bucket.reserved, 200_000)
})

test("stale reservations are released", async () => {
  const bucket = createBucket()
  bucket.limit = 1_000_000
  bucket.remaining = 1_000_000
  bucket.reservations.set({}, { tokens: 500_000, at: 0 })
  bucket.reserved = 500_000
  const { timing } = fakeTiming(200_000)

  await reserve(bucket, 100_000, {}, undefined, settings, timing, noop)

  assert.equal(bucket.reserved, 100_000)
})

test("release removes only its own reservation and is idempotent", () => {
  const bucket = createBucket()
  const first = {}
  const second = {}
  bucket.reservations.set(first, { tokens: 200_000, at: 0 })
  bucket.reservations.set(second, { tokens: 100_000, at: 1 })
  bucket.reserved = 300_000

  assert.equal(release(bucket, first), true)
  assert.equal(bucket.reserved, 100_000)
  assert.equal(release(bucket, first), false)
  assert.equal(bucket.reserved, 100_000)
})

test("an unknown request never releases someone else's reservation", () => {
  const bucket = createBucket()
  const held = {}
  bucket.reservations.set(held, { tokens: 200_000, at: 0 })
  bucket.reserved = 200_000

  assert.equal(release(bucket, {}), false)
  assert.equal(bucket.reserved, 200_000)
})

test("an aborted request releases its reservation", async () => {
  const bucket = createBucket()
  bucket.limit = 1_000_000
  bucket.remaining = 1_000_000
  const { timing } = fakeTiming()
  const controller = new AbortController()
  const key = {}

  await reserve(bucket, 100_000, key, controller.signal, settings, timing, noop)
  assert.equal(bucket.reserved, 100_000)

  controller.abort()
  assert.equal(bucket.reserved, 0)
  assert.equal(release(bucket, key), false)
})

test("a 429 closes the window until the token reset", () => {
  const bucket = createBucket()
  bucket.limit = 1_000_000
  bucket.remaining = 239_977

  observe(bucket, { resetMs: 45_601, retryAfterMs: 19_859 }, 429, 1_000, 2_000)

  assert.equal(bucket.remaining, 0)
  assert.equal(bucket.resetAt, 1_000 + 45_601)
})

test("normal responses update the bucket", () => {
  const bucket = createBucket()

  observe(bucket, { limit: 1_000_000, remaining: 999_000, resetMs: 30_000 }, 200, 1_000, 2_000)

  assert.equal(bucket.limit, 1_000_000)
  assert.equal(bucket.remaining, 999_000)
  assert.equal(bucket.resetAt, 31_000)
})

test("a non-finite estimate cannot poison the budget", async () => {
  const bucket = createBucket()
  bucket.limit = 1_000_000
  bucket.remaining = 1_000_000
  const { timing } = fakeTiming()
  const key = {}

  await reserve(bucket, Number.POSITIVE_INFINITY, key, undefined, settings, timing, noop)

  assert.equal(bucket.reserved, 40_000)
  release(bucket, key)
  assert.equal(bucket.reserved, 0)
})

test("two reservations for one request are counted once", async () => {
  const bucket = createBucket()
  bucket.limit = 1_000_000
  bucket.remaining = 1_000_000
  const { timing } = fakeTiming()
  const key = {}

  await Promise.all([
    reserve(bucket, 200_000, key, undefined, settings, timing, noop),
    reserve(bucket, 200_000, key, undefined, settings, timing, noop),
  ])

  assert.equal(bucket.reserved, 200_000)
  assert.equal(bucket.reservations.size, 1)
})

test("an already-aborted request is rejected before it reserves", async () => {
  const bucket = createBucket()
  bucket.limit = 1_000_000
  bucket.remaining = 1_000_000
  const { timing } = fakeTiming()
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    reserve(bucket, 100_000, {}, controller.signal, settings, timing, noop),
    /aborted|AbortError/i,
  )
  assert.equal(bucket.reserved, 0)
})

test("nonsense headers are ignored or clamped", () => {
  const bucket = createBucket()

  observe(bucket, { limit: -1, remaining: -5, resetMs: 1e12 }, 200, 1_000, 2_000)

  assert.equal(bucket.limit, 0)
  assert.equal(bucket.remaining, Number.POSITIVE_INFINITY)
  assert.equal(bucket.resetAt, 1_000 + 3_600_000)
})
