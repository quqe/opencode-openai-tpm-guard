export const DEFAULT_TOKENS_PER_CHAR = 0.3
export const ESTIMATE_FALLBACK_TOKENS = 40_000
/** Above this declared size, estimate from Content-Length instead of buffering the body. */
export const LARGE_BODY_BYTES = 16 * 1024 * 1024
/** Output headroom used when a large body cannot be inspected for max_output_tokens. */
export const LARGE_BODY_OUTPUT_TOKENS = 64_000

/**
 * Estimate the tokens a request will count against the TPM window: the serialized
 * input plus the reserved output budget. The body is read from a clone, so the real
 * request still streams untouched. Nothing is logged or stored.
 *
 * Large bodies (base64 images, attachments) are measured from Content-Length instead
 * of being duplicated in memory; bytes overestimate characters for non-ASCII text,
 * which errs on the safe side.
 */
export async function estimateRequestTokens(request: Request, tokensPerChar: number): Promise<number> {
  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > LARGE_BODY_BYTES) {
    return Math.ceil(declared * tokensPerChar) + LARGE_BODY_OUTPUT_TOKENS
  }
  try {
    const body = await request.clone().text()
    const output = /"max_(?:output_)?tokens"\s*:\s*(\d+)/.exec(body)?.[1]
    return Math.ceil(body.length * tokensPerChar) + (output ? Number(output) : 0)
  } catch {
    return ESTIMATE_FALLBACK_TOKENS
  }
}
