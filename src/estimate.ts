export const DEFAULT_TOKENS_PER_CHAR = 0.3
export const ESTIMATE_FALLBACK_TOKENS = 40_000
/** Above this declared size, estimate from Content-Length instead of buffering the body. */
export const LARGE_BODY_BYTES = 16 * 1024 * 1024
/** Without Content-Length, never buffer more than this many bytes of a body. */
export const MAX_BODY_READ_BYTES = 4 * 1024 * 1024
/** Output headroom used when a large body cannot be inspected for max output tokens. */
export const LARGE_BODY_OUTPUT_TOKENS = 64_000
/** No model reserves more than this for one reply; a larger value is a malformed body. */
export const MAX_OUTPUT_TOKENS = 2_000_000

const OUTPUT_PATTERN = /"max_(?:output_|completion_)?tokens"\s*:\s*(\d+)/

/** Read at most `maxBytes` from a clone; cancelling the clone leaves the real body intact. */
async function readPrefix(request: Request, maxBytes: number): Promise<string> {
  const clone = request.clone()
  if (!clone.body) return ""
  const reader = clone.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.byteLength === 0) continue
      const remaining = maxBytes - size
      const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value
      chunks.push(slice)
      size += slice.byteLength
      if (slice.byteLength < value.byteLength) break
    }
  } finally {
    // Do not await: cleanup must not block the request if the other tee branch stalls.
    void reader.cancel().catch(() => {})
  }
  const buffer = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(buffer)
}

/**
 * Estimate the tokens a request will count against the TPM window: the serialized
 * input plus the reserved output budget. The body is read from a clone, so the real
 * request still streams untouched. Nothing is logged or stored.
 *
 * Large bodies (base64 images, attachments) are measured from Content-Length instead
 * of being duplicated in memory. Without Content-Length the clone is read to a hard
 * cap and then cancelled, so a chunked body cannot exhaust memory.
 */
export async function estimateRequestTokens(request: Request, tokensPerChar: number): Promise<number> {
  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > LARGE_BODY_BYTES) {
    return Math.ceil(declared * tokensPerChar) + LARGE_BODY_OUTPUT_TOKENS
  }
  try {
    const body = await readPrefix(request, MAX_BODY_READ_BYTES)
    return Math.ceil(body.length * tokensPerChar) + outputTokens(body)
  } catch {
    return ESTIMATE_FALLBACK_TOKENS
  }
}

/** Clamp the declared output budget; a hostile or malformed number must not become Infinity. */
export function outputTokens(body: string): number {
  const raw = OUTPUT_PATTERN.exec(body)?.[1]
  if (!raw) return 0
  const value = Number(raw)
  if (!Number.isFinite(value)) return MAX_OUTPUT_TOKENS
  if (value <= 0) return 0
  return Math.min(Math.trunc(value), MAX_OUTPUT_TOKENS)
}
