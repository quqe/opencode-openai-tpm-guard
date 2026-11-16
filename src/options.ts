export interface GuardOptions {
  /** Master switch. */
  enabled: boolean
  /** Provider the guard applies to. Everything else is untouched. */
  providerID: string
  /** Rough tokens per character of the serialized request body. */
  tokensPerChar: number
  /** Headroom kept free in the window so an estimate miss does not become a 429. */
  safetyMarginTokens: number
  /** Longest single conscious pause before a request. */
  maxWaitMs: number
  /** Never retry a rate limit faster than this. */
  minRetryDelayMs: number
  /** Longest retry delay asked from OpenCode. */
  maxRetryDelayMs: number
  /** A reservation older than this is assumed lost (aborted request) and released. */
  reservationTtlMs: number
  /** Write pacing and 429 diagnostics to the private state log. */
  debug: boolean
}

/** Ten minutes: long enough for a TPM window, short enough not to look stuck. */
const MAX_PAUSE_MS = 600_000
const MAX_OUTPUT_MARGIN = 2_000_000

export const DEFAULT_OPTIONS: GuardOptions = {
  enabled: true,
  providerID: "openai",
  tokensPerChar: 0.3,
  safetyMarginTokens: 30_000,
  maxWaitMs: 300_000,
  minRetryDelayMs: 2_000,
  maxRetryDelayMs: 120_000,
  reservationTtlMs: 120_000,
  debug: false,
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** Validate plugin options; a typo degrades to a sane default instead of NaN delays. */
export function readOptions(raw: Readonly<Record<string, unknown>> | undefined): GuardOptions {
  const source = raw ?? {}
  return {
    enabled: asBoolean(source.enabled, DEFAULT_OPTIONS.enabled),
    providerID: asString(source.providerID, DEFAULT_OPTIONS.providerID),
    tokensPerChar: asNumber(source.tokensPerChar, DEFAULT_OPTIONS.tokensPerChar, 0.05, 1),
    safetyMarginTokens: Math.floor(
      asNumber(source.safetyMarginTokens, DEFAULT_OPTIONS.safetyMarginTokens, 0, MAX_OUTPUT_MARGIN),
    ),
    maxWaitMs: Math.floor(asNumber(source.maxWaitMs, DEFAULT_OPTIONS.maxWaitMs, 1_000, MAX_PAUSE_MS)),
    minRetryDelayMs: Math.floor(
      asNumber(source.minRetryDelayMs, DEFAULT_OPTIONS.minRetryDelayMs, 0, MAX_PAUSE_MS),
    ),
    maxRetryDelayMs: Math.floor(
      asNumber(source.maxRetryDelayMs, DEFAULT_OPTIONS.maxRetryDelayMs, 1_000, MAX_PAUSE_MS),
    ),
    reservationTtlMs: Math.floor(
      asNumber(source.reservationTtlMs, DEFAULT_OPTIONS.reservationTtlMs, 1_000, MAX_PAUSE_MS),
    ),
    debug: asBoolean(source.debug, DEFAULT_OPTIONS.debug),
  }
}
