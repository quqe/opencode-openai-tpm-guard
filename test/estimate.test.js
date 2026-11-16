import assert from "node:assert/strict"
import test from "node:test"
import {
  estimateRequestTokens,
  LARGE_BODY_BYTES,
  LARGE_BODY_OUTPUT_TOKENS,
  MAX_BODY_READ_BYTES,
  MAX_OUTPUT_TOKENS,
  outputTokens,
} from "../dist/estimate.js"

test("outputTokens reads and clamps every OpenAI output field", () => {
  assert.equal(outputTokens('{"max_tokens":128000}'), 128_000)
  assert.equal(outputTokens('{"max_output_tokens":64000}'), 64_000)
  assert.equal(outputTokens('{"max_completion_tokens":32000}'), 32_000)
  assert.equal(outputTokens(`{"max_tokens":${"9".repeat(400)}}`), MAX_OUTPUT_TOKENS)
  assert.equal(outputTokens('{"max_tokens":"999"}'), 0)
  assert.equal(outputTokens('{"max_tokens":-5}'), 0)
  assert.equal(outputTokens('{"other":1}'), 0)
})

test("a small body is estimated from its text and output budget", async () => {
  const request = new Request("https://example.test/v1/responses", {
    method: "POST",
    body: JSON.stringify({ max_tokens: 2_000, input: "hello" }),
  })
  const tokens = await estimateRequestTokens(request, 0.3)
  assert.ok(tokens >= 2_000)
  assert.ok(tokens < 100_000)
})

test("a declared large body is measured from Content-Length without reading it", async () => {
  let cloned = false
  const request = {
    headers: new Headers({ "content-length": String(LARGE_BODY_BYTES + 1) }),
    clone() {
      cloned = true
      throw new Error("body must not be cloned")
    },
  }
  const tokens = await estimateRequestTokens(request, 0.3)
  assert.equal(cloned, false)
  assert.equal(tokens, Math.ceil((LARGE_BODY_BYTES + 1) * 0.3) + LARGE_BODY_OUTPUT_TOKENS)
})

test("an unreadable body falls back to a conservative estimate", async () => {
  const request = {
    headers: new Headers(),
    clone() {
      throw new Error("stream already used")
    },
  }
  assert.equal(await estimateRequestTokens(request, 0.3), 40_000)
})

test("a body without Content-Length is capped instead of buffered whole", async () => {
  const body = "a".repeat(MAX_BODY_READ_BYTES + 1024 * 1024)
  const request = new Request("https://example.test/v1/responses", { method: "POST", body })
  request.headers.delete("content-length")

  // Consume the other tee branch, as the real HTTP client does, so cancelling the
  // clone cannot stall the estimate.
  const pending = estimateRequestTokens(request, 0.3)
  await request.arrayBuffer()
  const tokens = await pending

  assert.ok(tokens >= Math.ceil(MAX_BODY_READ_BYTES * 0.3))
  assert.ok(tokens < Math.ceil(body.length * 0.3))
})
