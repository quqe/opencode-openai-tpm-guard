export interface WindowSnapshot {
  limit?: number
  remaining?: number
  resetMs?: number
  retryAfterMs?: number
}

/** Parse a plain integer header, or undefined when it is missing or not numeric. */
export function parseInteger(raw: string | null | undefined): number | undefined {
  if (raw == null) return undefined
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) ? value : undefined
}

/**
 * OpenAI durations look like "45.601s", "6m0s", "12ms" and "1h".
 * A bare number is interpreted as seconds, which is how `retry-after` is defined.
 */
export function parseDurationMs(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined
  let total = 0
  let matched = false
  for (const match of raw.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) {
    matched = true
    const amount = Number(match[1])
    const unit = match[2]
    const scale = unit === "ms" ? 1 : unit === "s" ? 1_000 : unit === "m" ? 60_000 : 3_600_000
    total += amount * scale
  }
  if (matched) return total
  const seconds = Number(raw)
  return Number.isFinite(seconds) ? seconds * 1_000 : undefined
}

/** Read the OpenAI token bucket from response headers. */
export function readWindow(headers: Headers): WindowSnapshot {
  return {
    limit: parseInteger(headers.get("x-ratelimit-limit-tokens")),
    remaining: parseInteger(headers.get("x-ratelimit-remaining-tokens")),
    resetMs: parseDurationMs(headers.get("x-ratelimit-reset-tokens")),
    retryAfterMs:
      parseInteger(headers.get("retry-after-ms")) ?? parseDurationMs(headers.get("retry-after")),
  }
}

/** The 429 body repeats the same headers; use them when no response hook ran. */
export function readWindowFromErrorBody(body: string | undefined): WindowSnapshot {
  if (!body) return {}
  try {
    const headers = (JSON.parse(body) as { error?: { headers?: Record<string, string> } })?.error?.headers
    if (!headers || typeof headers !== "object") return {}
    return {
      resetMs: parseDurationMs(headers["x-ratelimit-reset-tokens"]),
      retryAfterMs:
        parseInteger(headers["retry-after-ms"]) ?? parseDurationMs(headers["retry-after"]),
    }
  } catch {
    return {}
  }
}
