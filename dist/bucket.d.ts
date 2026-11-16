import type { WindowSnapshot } from "./headers.js";
import type { Logger } from "./log.js";
export interface Bucket {
    limit: number;
    remaining: number;
    resetAt: number;
    reserved: number;
    reservations: {
        tokens: number;
        at: number;
    }[];
    /** Serializes gate decisions for this model so concurrent requests share one budget. */
    gate: Promise<void>;
}
export interface Timing {
    now: () => number;
    sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}
export interface ReserveSettings {
    safetyMarginTokens: number;
    maxWaitMs: number;
    reservationTtlMs: number;
}
export declare function createBucket(): Bucket;
export declare function release(bucket: Bucket): void;
/** Apply a response's headers to the bucket. */
export declare function observe(bucket: Bucket, snapshot: WindowSnapshot, status: number | undefined, now: number, minRetryDelayMs: number): void;
/**
 * Claim `tokens` from the window, waiting until the reset brings enough room back.
 * A pause is bounded by `maxWaitMs`; after that the request is sent anyway and the
 * ordinary 429 retry path takes over.
 */
export declare function reserve(bucket: Bucket, tokens: number, signal: AbortSignal | undefined, settings: ReserveSettings, timing: Timing, log: Logger): Promise<void>;
