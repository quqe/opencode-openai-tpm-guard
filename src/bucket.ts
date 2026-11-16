import type { WindowSnapshot } from "./headers.js"
import type { Logger } from "./log.js"

export interface Reservation {
  tokens: number
  at: number
  signal?: AbortSignal
  onAbort?: () => void
}

export interface Bucket {
  limit: number
  remaining: number
  resetAt: number
  reserved: number
  /** Keyed by the Request object, so a response releases exactly its own reservation. */
  reservations: Map<object, Reservation>
  /** Serializes gate decisions for this model so concurrent requests share one budget. */
  gate: Promise<void>
}

export interface Timing {
  now: () => number
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>
}

export interface ReserveSettings {
  safetyMarginTokens: number
  maxWaitMs: number
  reservationTtlMs: number
}

export function createBucket(): Bucket {
  return {
    limit: 0,
    remaining: Number.POSITIVE_INFINITY,
    resetAt: 0,
    reserved: 0,
    reservations: new Map(),
    gate: Promise.resolve(),
  }
}

/** Release the reservation made for `key`, if it is still held. Idempotent. */
export function release(bucket: Bucket, key: object): boolean {
  const reservation = bucket.reservations.get(key)
  if (!reservation) return false
  bucket.reservations.delete(key)
  bucket.reserved = Math.max(0, bucket.reserved - reservation.tokens)
  if (reservation.signal && reservation.onAbort) {
    reservation.signal.removeEventListener("abort", reservation.onAbort)
  }
  return true
}

function claim(bucket: Bucket, key: object, tokens: number, now: number, signal?: AbortSignal): void {
  if (signal?.aborted) return
  if (bucket.reservations.has(key)) return
  const reservation: Reservation = { tokens, at: now, signal }
  if (signal) {
    reservation.onAbort = () => release(bucket, key)
    signal.addEventListener("abort", reservation.onAbort, { once: true })
  }
  bucket.reservations.set(key, reservation)
  bucket.reserved += tokens
}

function prune(bucket: Bucket, now: number, ttl: number): void {
  for (const [key, reservation] of bucket.reservations) {
    if (now - reservation.at > ttl) release(bucket, key)
  }
}

/** Apply a response's headers to the bucket. */
export function observe(
  bucket: Bucket,
  snapshot: WindowSnapshot,
  status: number | undefined,
  now: number,
  minRetryDelayMs: number,
): void {
  if (snapshot.limit !== undefined) bucket.limit = snapshot.limit
  if (snapshot.remaining !== undefined) bucket.remaining = snapshot.remaining
  if (snapshot.resetMs !== undefined) bucket.resetAt = now + snapshot.resetMs
  if (status === 429) {
    bucket.remaining = 0
    bucket.resetAt =
      now + Math.max(snapshot.resetMs ?? 0, snapshot.retryAfterMs ?? 0, minRetryDelayMs)
  }
}

/**
 * Claim `tokens` from the window, waiting until the reset brings enough room back.
 * A pause is bounded by `maxWaitMs`; after that the request is sent anyway and the
 * ordinary 429 retry path takes over. A request larger than the whole window can
 * never fit, so it is sent immediately instead of pausing for nothing.
 */
export function reserve(
  bucket: Bucket,
  tokens: number,
  key: object,
  signal: AbortSignal | undefined,
  settings: ReserveSettings,
  timing: Timing,
  log: Logger,
): Promise<void> {
  if (bucket.reservations.has(key)) return Promise.resolve()

  const run = bucket.gate.then(async () => {
    const deadline = timing.now() + settings.maxWaitMs
    while (true) {
      prune(bucket, timing.now(), settings.reservationTtlMs)

      const now = timing.now()
      if (bucket.resetAt > 0 && now >= bucket.resetAt) {
        bucket.remaining = bucket.limit > 0 ? bucket.limit : Number.POSITIVE_INFINITY
        bucket.resetAt = 0
      }

      const available = bucket.remaining - bucket.reserved
      const impossible =
        bucket.limit > 0 && tokens + settings.safetyMarginTokens > bucket.limit
      const fits =
        bucket.remaining === Number.POSITIVE_INFINITY ||
        available >= tokens + settings.safetyMarginTokens

      if (fits || impossible) {
        if (impossible) {
          log("request exceeds the window, sending anyway", {
            need: tokens,
            limit: bucket.limit,
          })
        }
        claim(bucket, key, tokens, now, signal)
        if (!impossible) {
          log("pass", {
            need: tokens,
            available: Number.isFinite(available) ? available : "unbounded",
            reserved: bucket.reserved,
            limit: bucket.limit,
          })
        }
        return
      }

      if (now >= deadline) {
        log("pause limit reached, sending anyway", { available, need: tokens })
        claim(bucket, key, tokens, now, signal)
        return
      }

      const untilReset = bucket.resetAt > now ? bucket.resetAt - now + 250 : 5_000
      const wait = Math.max(250, Math.min(untilReset, deadline - now, 15_000))
      log("pausing", {
        waitMs: Math.round(wait),
        available,
        reserved: bucket.reserved,
        need: tokens,
        limit: bucket.limit,
      })
      await timing.sleep(wait, signal)
    }
  })
  bucket.gate = run.catch(() => {})
  return run
}
