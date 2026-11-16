export declare const DEFAULT_TOKENS_PER_CHAR = 0.3;
export declare const ESTIMATE_FALLBACK_TOKENS = 40000;
/** Above this declared size, estimate from Content-Length instead of buffering the body. */
export declare const LARGE_BODY_BYTES: number;
/** Without Content-Length, never buffer more than this many bytes of a body. */
export declare const MAX_BODY_READ_BYTES: number;
/** A slow or stalled stream must not indefinitely hold up the real request. */
export declare const MAX_BODY_READ_MS = 1000;
/** Output headroom used when a large body cannot be inspected for max output tokens. */
export declare const LARGE_BODY_OUTPUT_TOKENS = 64000;
/** No model reserves more than this for one reply; a larger value is a malformed body. */
export declare const MAX_OUTPUT_TOKENS = 2000000;
/**
 * Estimate the tokens a request will count against the TPM window: the serialized
 * input plus the reserved output budget. The body is read from a clone, so the real
 * request still streams untouched. Nothing is logged or stored.
 *
 * Large bodies (base64 images, attachments) are measured from Content-Length instead
 * of being duplicated in memory. Without Content-Length the clone is read to a hard
 * cap and then cancelled, so a chunked body cannot exhaust memory.
 */
export declare function estimateRequestTokens(request: Request, tokensPerChar: number): Promise<number>;
/** Clamp the declared output budget; a hostile or malformed number must not become Infinity. */
export declare function outputTokens(body: string): number;
