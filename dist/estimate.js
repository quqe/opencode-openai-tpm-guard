export const DEFAULT_TOKENS_PER_CHAR = 0.3;
export const ESTIMATE_FALLBACK_TOKENS = 40_000;
/** Above this declared size, estimate from Content-Length instead of buffering the body. */
export const LARGE_BODY_BYTES = 16 * 1024 * 1024;
/** Output headroom used when a large body cannot be inspected for max output tokens. */
export const LARGE_BODY_OUTPUT_TOKENS = 64_000;
/** No model reserves more than this for one reply; a larger value is a malformed body. */
export const MAX_OUTPUT_TOKENS = 2_000_000;
const OUTPUT_PATTERN = /"max_(?:output_|completion_)?tokens"\s*:\s*(\d+)/;
/**
 * Estimate the tokens a request will count against the TPM window: the serialized
 * input plus the reserved output budget. The body is read from a clone, so the real
 * request still streams untouched. Nothing is logged or stored.
 *
 * Large bodies (base64 images, attachments) are measured from Content-Length instead
 * of being duplicated in memory; bytes overestimate characters for non-ASCII text,
 * which errs on the safe side.
 */
export async function estimateRequestTokens(request, tokensPerChar) {
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > LARGE_BODY_BYTES) {
        return Math.ceil(declared * tokensPerChar) + LARGE_BODY_OUTPUT_TOKENS;
    }
    try {
        const body = await request.clone().text();
        return Math.ceil(body.length * tokensPerChar) + outputTokens(body);
    }
    catch {
        return ESTIMATE_FALLBACK_TOKENS;
    }
}
/** Clamp the declared output budget; a hostile or malformed number must not become Infinity. */
export function outputTokens(body) {
    const raw = OUTPUT_PATTERN.exec(body)?.[1];
    if (!raw)
        return 0;
    const value = Number(raw);
    if (!Number.isFinite(value))
        return MAX_OUTPUT_TOKENS;
    if (value <= 0)
        return 0;
    return Math.min(Math.trunc(value), MAX_OUTPUT_TOKENS);
}
