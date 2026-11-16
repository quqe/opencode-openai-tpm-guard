export declare const DEFAULT_TOKENS_PER_CHAR = 0.3;
export declare const ESTIMATE_FALLBACK_TOKENS = 40000;
/**
 * Estimate the tokens a request will count against the TPM window: the serialized
 * input plus the reserved output budget. The body is read from a clone, so the real
 * request still streams untouched. Nothing is logged or stored.
 */
export declare function estimateRequestTokens(request: Request, tokensPerChar: number): Promise<number>;
