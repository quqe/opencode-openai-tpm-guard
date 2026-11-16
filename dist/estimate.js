export const DEFAULT_TOKENS_PER_CHAR = 0.3;
export const ESTIMATE_FALLBACK_TOKENS = 40_000;
/**
 * Estimate the tokens a request will count against the TPM window: the serialized
 * input plus the reserved output budget. The body is read from a clone, so the real
 * request still streams untouched. Nothing is logged or stored.
 */
export async function estimateRequestTokens(request, tokensPerChar) {
    try {
        const body = await request.clone().text();
        const output = /"max_(?:output_)?tokens"\s*:\s*(\d+)/.exec(body)?.[1];
        return Math.ceil(body.length * tokensPerChar) + (output ? Number(output) : 0);
    }
    catch {
        return ESTIMATE_FALLBACK_TOKENS;
    }
}
