import assert from "node:assert/strict"
import test from "node:test"
import {
  parseDurationMs,
  parseInteger,
  parseRetryAfter,
  readWindow,
  readWindowFromErrorBody,
} from "../dist/headers.js"

test("parseInteger", () => {
  assert.equal(parseInteger("1000000"), 1_000_000)
  assert.equal(parseInteger(null), undefined)
  assert.equal(parseInteger("abc"), undefined)
})

test("parseDurationMs understands OpenAI duration headers", () => {
  assert.equal(parseDurationMs("45.601s"), 45_601)
  assert.equal(parseDurationMs("6m0s"), 360_000)
  assert.equal(parseDurationMs("12ms"), 12)
  assert.equal(parseDurationMs("1h"), 3_600_000)
  assert.equal(parseDurationMs("20"), 20_000)
  assert.equal(parseDurationMs("8s522ms"), 8_522)
  assert.equal(parseDurationMs("garbage"), undefined)
  assert.equal(parseDurationMs(null), undefined)
})

test("parseRetryAfter handles seconds and HTTP dates", () => {
  const now = Date.parse("2026-11-16T12:00:00Z")
  assert.equal(parseRetryAfter("20"), 20_000)
  assert.equal(parseRetryAfter("Mon, 16 Nov 2026 12:00:30 GMT", now), 30_000)
  assert.equal(parseRetryAfter("Sun, 16 Nov 2025 12:00:00 GMT", now), 0)
  assert.equal(parseRetryAfter("garbage"), undefined)
  assert.equal(parseRetryAfter(null), undefined)
})

test("readWindow reads the OpenAI token bucket", () => {
  const headers = new Headers({
    "x-ratelimit-limit-tokens": "1000000",
    "x-ratelimit-remaining-tokens": "239977",
    "x-ratelimit-reset-tokens": "45.601s",
    "retry-after": "20",
  })
  assert.deepEqual(readWindow(headers), {
    limit: 1_000_000,
    remaining: 239_977,
    resetMs: 45_601,
    retryAfterMs: 20_000,
  })
})

test("readWindow prefers retry-after-ms over retry-after", () => {
  const headers = new Headers({ "retry-after": "20", "retry-after-ms": "19859" })
  assert.equal(readWindow(headers).retryAfterMs, 19_859)
})

test("readWindowFromErrorBody reads the repeated 429 headers", () => {
  const body = JSON.stringify({
    type: "error",
    error: {
      type: "tokens",
      code: "rate_limit_exceeded",
      headers: {
        "retry-after": "20",
        "retry-after-ms": "19859",
        "x-ratelimit-reset-tokens": "45.601s",
      },
    },
  })
  assert.deepEqual(readWindowFromErrorBody(body), { resetMs: 45_601, retryAfterMs: 19_859 })
  assert.deepEqual(readWindowFromErrorBody("not json"), {})
  assert.deepEqual(readWindowFromErrorBody(undefined), {})
})

test("readWindowFromErrorBody ignores oversized bodies", () => {
  assert.deepEqual(readWindowFromErrorBody("x".repeat(1_000_001)), {})
})
