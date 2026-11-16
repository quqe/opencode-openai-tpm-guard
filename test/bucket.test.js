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

  await reserve(bucket, 200_000, undefined, settings, timing, noop)

  assert.equal(sleeps.length, 0)
  assert.equal(bucket.reserved, 200_000)
  assert.equal(bucket.reservations.length, 1)
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

  await reserve(bucket, 200_000, undefined, settings, timing, noop)

  assert.ok(fake.sleeps.length > 0, "expected at least one pause")
  assert.equal(bucket.reserved, 200_000)
})

test("the pause is bounded by maxWaitMs", async () => {
  const bucket = createBucket()
  bucket.limit = 1_000_000
  bucket.remaining = 0
  bucket.resetAt = 3_600_000
  const { timing, sleeps } = fakeTiming()

  await reserve(bucket, 200_000, undefined, { ...settings, maxWaitMs: 5_000 }, timing, noop)

  assert.equal(sleeps.reduce((sum, ms) => sum + ms, 0), 5_000)
  assert.equal(bucket.reserved, 200_000)
})

test("stale reservations are released", async () => {
  const bucket = createBucket()
  bucket.limit = 1_000_000
  bucket.remaining = 1_000_000
  bucket.reserved = 500_000
  bucket.reservations.push({ tokens: 500_000, at: 0 })
  const { timing } = fakeTiming(200_000)

  await reserve(bucket, 100_000, undefined, settings, timing, noop)

  assert.equal(bucket.reserved, 100_000)
})

test("release removes the oldest reservation", () => {
  const bucket = createBucket()
  bucket.reserved = 300_000
  bucket.reservations.push({ tokens: 200_000, at: 0 }, { tokens: 100_000, at: 1 })

  release(bucket)

  assert.equal(bucket.reserved, 100_000)
  assert.equal(bucket.reservations.length, 1)
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
