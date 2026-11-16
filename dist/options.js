/** Ten minutes: long enough for a TPM window, short enough not to look stuck. */
const MAX_PAUSE_MS = 600_000;
const MAX_OUTPUT_MARGIN = 2_000_000;
export const DEFAULT_OPTIONS = {
    enabled: true,
    providerID: "openai",
    tokensPerChar: 0.3,
    safetyMarginTokens: 30_000,
    maxWaitMs: 300_000,
    minRetryDelayMs: 2_000,
    maxRetryDelayMs: 120_000,
    reservationTtlMs: 120_000,
    debug: false,
};
function asBoolean(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
}
function asString(value, fallback) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}
function asNumber(value, fallback, min, max) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return fallback;
    return Math.min(max, Math.max(min, value));
}
/** Validate plugin options; a typo degrades to a sane default instead of NaN delays. */
export function readOptions(raw) {
    const source = raw ?? {};
    return {
        enabled: asBoolean(source.enabled, DEFAULT_OPTIONS.enabled),
        providerID: asString(source.providerID, DEFAULT_OPTIONS.providerID),
        tokensPerChar: asNumber(source.tokensPerChar, DEFAULT_OPTIONS.tokensPerChar, 0.05, 1),
        safetyMarginTokens: Math.floor(asNumber(source.safetyMarginTokens, DEFAULT_OPTIONS.safetyMarginTokens, 0, MAX_OUTPUT_MARGIN)),
        maxWaitMs: Math.floor(asNumber(source.maxWaitMs, DEFAULT_OPTIONS.maxWaitMs, 1_000, MAX_PAUSE_MS)),
        minRetryDelayMs: Math.floor(asNumber(source.minRetryDelayMs, DEFAULT_OPTIONS.minRetryDelayMs, 0, MAX_PAUSE_MS)),
        maxRetryDelayMs: Math.floor(asNumber(source.maxRetryDelayMs, DEFAULT_OPTIONS.maxRetryDelayMs, 1_000, MAX_PAUSE_MS)),
        reservationTtlMs: Math.floor(asNumber(source.reservationTtlMs, DEFAULT_OPTIONS.reservationTtlMs, 1_000, MAX_PAUSE_MS)),
        debug: asBoolean(source.debug, DEFAULT_OPTIONS.debug),
    };
}
