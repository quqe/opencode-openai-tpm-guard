export interface GuardOptions {
    /** Master switch. */
    enabled: boolean;
    /** Provider the guard applies to. Everything else is untouched. */
    providerID: string;
    /** Rough tokens per character of the serialized request body. */
    tokensPerChar: number;
    /** Headroom kept free in the window so an estimate miss does not become a 429. */
    safetyMarginTokens: number;
    /** Longest single conscious pause before a request. */
    maxWaitMs: number;
    /** Never retry a rate limit faster than this. */
    minRetryDelayMs: number;
    /** Longest retry delay asked from OpenCode. */
    maxRetryDelayMs: number;
    /** A reservation older than this is assumed lost (aborted request) and released. */
    reservationTtlMs: number;
    /** Write pacing and 429 diagnostics. */
    debug: boolean;
    /** Debug log destination; null writes to stderr. */
    logFile: string | null;
}
export declare const DEFAULT_LOG_FILE = "/tmp/opencode/openai-tpm-guard.log";
export declare const DEFAULT_OPTIONS: GuardOptions;
/** Validate plugin options; a typo degrades to a sane default instead of NaN delays. */
export declare function readOptions(raw: Readonly<Record<string, unknown>> | undefined): GuardOptions;
