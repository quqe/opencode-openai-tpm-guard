/** Parse a plain integer header, or undefined when it is missing or not numeric. */
export function parseInteger(raw) {
    if (raw == null)
        return undefined;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : undefined;
}
/**
 * OpenAI durations look like "45.601s", "6m0s", "12ms" and "1h".
 * A bare number is interpreted as seconds, which is how `retry-after` is defined.
 */
export function parseDurationMs(raw) {
    if (!raw)
        return undefined;
    let total = 0;
    let matched = false;
    for (const match of raw.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) {
        matched = true;
        const amount = Number(match[1]);
        const unit = match[2];
        const scale = unit === "ms" ? 1 : unit === "s" ? 1_000 : unit === "m" ? 60_000 : 3_600_000;
        total += amount * scale;
    }
    if (matched)
        return total;
    const seconds = Number(raw);
    return Number.isFinite(seconds) ? seconds * 1_000 : undefined;
}
/**
 * `retry-after` is either delay-seconds or an HTTP-date; `retry-after-ms` is always
 * milliseconds and must not be passed through {@link parseDurationMs}.
 */
export function parseRetryAfter(raw, now = Date.now()) {
    if (!raw)
        return undefined;
    const trimmed = raw.trim();
    if (trimmed.length === 0)
        return undefined;
    if (/^\d+(?:\.\d+)?$/.test(trimmed))
        return Number(trimmed) * 1_000;
    const date = Date.parse(trimmed);
    if (Number.isNaN(date))
        return undefined;
    return Math.max(0, date - now);
}
/** Read the OpenAI token bucket from response headers. */
export function readWindow(headers) {
    return {
        limit: parseInteger(headers.get("x-ratelimit-limit-tokens")),
        remaining: parseInteger(headers.get("x-ratelimit-remaining-tokens")),
        resetMs: parseDurationMs(headers.get("x-ratelimit-reset-tokens")),
        retryAfterMs: parseInteger(headers.get("retry-after-ms")) ?? parseRetryAfter(headers.get("retry-after")),
    };
}
/** The 429 body repeats the same headers; use them when no response hook ran. */
export function readWindowFromErrorBody(body) {
    if (!body)
        return {};
    // Error bodies are small; do not let a hostile endpoint make us parse megabytes.
    if (body.length > 1_000_000)
        return {};
    try {
        const headers = JSON.parse(body)?.error?.headers;
        if (!headers || typeof headers !== "object")
            return {};
        return {
            resetMs: parseDurationMs(headers["x-ratelimit-reset-tokens"]),
            retryAfterMs: parseInteger(headers["retry-after-ms"]) ?? parseRetryAfter(headers["retry-after"]),
        };
    }
    catch {
        return {};
    }
}
