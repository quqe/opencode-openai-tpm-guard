export declare const DEFAULT_TOKENS_PER_CHAR = 0.3;
export declare const ESTIMATE_FALLBACK_TOKENS = 40000;
/** Above this declared size, estimate from Content-Length instead of buffering the body. */
export declare const LARGE_BODY_BYTES: number;
/** Output headroom used when a large body cannot be inspected for max_output_tokens. */
export declare const LARGE_BODY_OUTPUT_TOKENS = 64000;
/**
 * Estimate the tokens a request will count against the TPM window: the serialized
 * input plus the reserved output budget. The body is read from a clone, so the real
 * request still streams untouched. Nothing is logged or stored.
 *
 * Large bodies (base64 images, attachments) are measured from Content-Length instead
 * of being duplicated in memory; bytes overestimate characters for non-ASCII text,
 * which errs on the safe side.
 */
export declare function estimateRequestTokens(request: Request, tokensPerChar: number): Promise<number>;
