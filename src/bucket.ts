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

/** A TPM window is at most a minute; anything longer is a malformed header. */
const MAX_WINDOW_MS = 3_600_000
/** No single request reserves more than this; larger estimates are clamped. */
const MAX_RESERVATION_TOKENS = 2_000_000
const FALLBACK_TOKENS = 40_000

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

function normalizeTokens(tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return FALLBACK_TOKENS
  return Math.min(Math.trunc(tokens), MAX_RESERVATION_TOKENS)
}

/** Release the reservation made for `key`, if it is still held. Idempotent. */
export function release(bucket: Bucket, key: object): boolean {
  const reservation = bucket.reservations.get(key)
  if (!reservation) return false
  bucket.reservations.delete(key)
  bucket.reserved = Math.max(0, bucket.reserved - Math.max(0, reservation.tokens))
  if (!Number.isFinite(bucket.reserved)) bucket.reserved = 0
  if (reservation.signal && reservation.onAbort) {
    reservation.signal.removeEventListener("abort", reservation.onAbort)
  }
  return true
}

function claim(bucket: Bucket, key: object, tokens: number, now: number, signal?: AbortSignal): void {
  if (signal?.aborted) return
  if (bucket.reservations.has(key)) return
  if (!Number.isFinite(bucket.reserved)) bucket.reserved = 0
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
    if (!Number.isFinite(reservation.at) || now - reservation.at > ttl) release(bucket, key)
  }
}

function repair(bucket: Bucket): void {
  if (!Number.isFinite(bucket.reserved) || bucket.reserved < 0) bucket.reserved = 0
  if (!Number.isFinite(bucket.limit) || bucket.limit < 0) bucket.limit = 0
  if (!Number.isFinite(bucket.resetAt) || bucket.resetAt < 0) bucket.resetAt = 0
  if (bucket.remaining !== Number.POSITIVE_INFINITY && !Number.isFinite(bucket.remaining)) {
    bucket.remaining = Number.POSITIVE_INFINITY
  }
}

/** Apply a response's headers to the bucket, ignoring nonsense values. */
export function observe(
  bucket: Bucket,
  snapshot: WindowSnapshot,
  status: number | undefined,
  now: number,
  minRetryDelayMs: number,
): void {
  if (snapshot.limit !== undefined && Number.isFinite(snapshot.limit) && snapshot.limit > 0) {
    bucket.limit = Math.trunc(snapshot.limit)
  }
  if (snapshot.remaining !== undefined && Number.isFinite(snapshot.remaining) && snapshot.remaining >= 0) {
    bucket.remaining = Math.trunc(snapshot.remaining)
  }
  if (snapshot.resetMs !== undefined && Number.isFinite(snapshot.resetMs) && snapshot.resetMs >= 0) {
    bucket.resetAt = now + Math.min(snapshot.resetMs, MAX_WINDOW_MS)
  }
  if (status === 429) {
    const delay = Math.max(snapshot.resetMs ?? 0, snapshot.retryAfterMs ?? 0, minRetryDelayMs)
    bucket.remaining = 0
    bucket.resetAt = now + Math.min(Number.isFinite(delay) ? delay : minRetryDelayMs, MAX_WINDOW_MS)
  }
  repair(bucket)
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

  const amount = normalizeTokens(tokens)
  // The deadline starts when the request asks for a slot, not after it reaches the front
  // of the queue; otherwise a burst of N requests multiplies maxWaitMs by N.
  const deadline = timing.now() + settings.maxWaitMs

  const run = bucket.gate.then(async () => {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new Error("aborted")
      prune(bucket, timing.now(), settings.reservationTtlMs)
      repair(bucket)

      const now = timing.now()
      if (bucket.resetAt > 0 && now >= bucket.resetAt) {
        bucket.remaining = bucket.limit > 0 ? bucket.limit : Number.POSITIVE_INFINITY
        bucket.resetAt = 0
      }

      const available = bucket.remaining - bucket.reserved
      const impossible = bucket.limit > 0 && amount + settings.safetyMarginTokens > bucket.limit
      const fits =
        bucket.remaining === Number.POSITIVE_INFINITY ||
        available >= amount + settings.safetyMarginTokens

      if (fits || impossible) {
        if (signal?.aborted) throw signal.reason ?? new Error("aborted")
        if (impossible) {
          log("request exceeds the window, sending anyway", {
            need: amount,
            limit: bucket.limit,
          })
        }
        claim(bucket, key, amount, now, signal)
        if (!impossible) {
          log("pass", {
            need: amount,
            available: Number.isFinite(available) ? available : "unbounded",
            reserved: bucket.reserved,
            limit: bucket.limit,
          })
        }
        return
      }

      if (now >= deadline) {
        log("pause limit reached, sending anyway", { available, need: amount })
        claim(bucket, key, amount, now, signal)
        return
      }

      const untilReset = bucket.resetAt > now ? bucket.resetAt - now + 250 : 5_000
      const wait = Math.max(250, Math.min(untilReset, deadline - now, 15_000))
      log("pausing", {
        waitMs: Math.round(wait),
        available,
        reserved: bucket.reserved,
        need: amount,
        limit: bucket.limit,
      })
      await timing.sleep(wait, signal)
    }
  })
  bucket.gate = run.catch(() => {})
  return run
}
