export interface WindowSnapshot {
    limit?: number;
    remaining?: number;
    resetMs?: number;
    retryAfterMs?: number;
}
/** Parse a plain integer header, or undefined when it is missing or not numeric. */
export declare function parseInteger(raw: string | null | undefined): number | undefined;
/**
 * OpenAI durations look like "45.601s", "6m0s", "12ms" and "1h".
 * A bare number is interpreted as seconds, which is how `retry-after` is defined.
 */
export declare function parseDurationMs(raw: string | null | undefined): number | undefined;
/** Read the OpenAI token bucket from response headers. */
export declare function readWindow(headers: Headers): WindowSnapshot;
/** The 429 body repeats the same headers; use them when no response hook ran. */
export declare function readWindowFromErrorBody(body: string | undefined): WindowSnapshot;
