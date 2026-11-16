import type { WindowSnapshot } from "./headers.js";
import type { Logger } from "./log.js";
export interface Reservation {
    tokens: number;
    at: number;
    signal?: AbortSignal;
    onAbort?: () => void;
}
export interface Bucket {
    limit: number;
    remaining: number;
    resetAt: number;
    reserved: number;
    /** Keyed by the Request object, so a response releases exactly its own reservation. */
    reservations: Map<object, Reservation>;
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
/** Release the reservation made for `key`, if it is still held. Idempotent. */
export declare function release(bucket: Bucket, key: object): boolean;
/** Apply a response's headers to the bucket, ignoring nonsense values. */
export declare function observe(bucket: Bucket, snapshot: WindowSnapshot, status: number | undefined, now: number, minRetryDelayMs: number): void;
/**
 * Claim `tokens` from the window, waiting until the reset brings enough room back.
 * A pause is bounded by `maxWaitMs`; after that the request is sent anyway and the
 * ordinary 429 retry path takes over. A request larger than the whole window can
 * never fit, so it is sent immediately instead of pausing for nothing.
 */
export declare function reserve(bucket: Bucket, tokens: number, key: object, signal: AbortSignal | undefined, settings: ReserveSettings, timing: Timing, log: Logger): Promise<void>;
