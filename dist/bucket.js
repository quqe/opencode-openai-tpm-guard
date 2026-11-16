export function createBucket() {
    return {
        limit: 0,
        remaining: Number.POSITIVE_INFINITY,
        resetAt: 0,
        reserved: 0,
        reservations: [],
        gate: Promise.resolve(),
    };
}
export function release(bucket) {
    const reservation = bucket.reservations.shift();
    if (reservation)
        bucket.reserved = Math.max(0, bucket.reserved - reservation.tokens);
}
/** Apply a response's headers to the bucket. */
export function observe(bucket, snapshot, status, now, minRetryDelayMs) {
    if (snapshot.limit !== undefined)
        bucket.limit = snapshot.limit;
    if (snapshot.remaining !== undefined)
        bucket.remaining = snapshot.remaining;
    if (snapshot.resetMs !== undefined)
        bucket.resetAt = now + snapshot.resetMs;
    if (status === 429) {
        bucket.remaining = 0;
        bucket.resetAt =
            now + Math.max(snapshot.resetMs ?? 0, snapshot.retryAfterMs ?? 0, minRetryDelayMs);
    }
}
/**
 * Claim `tokens` from the window, waiting until the reset brings enough room back.
 * A pause is bounded by `maxWaitMs`; after that the request is sent anyway and the
 * ordinary 429 retry path takes over.
 */
export function reserve(bucket, tokens, signal, settings, timing, log) {
    const run = bucket.gate.then(async () => {
        const deadline = timing.now() + settings.maxWaitMs;
        while (true) {
            const cutoff = timing.now() - settings.reservationTtlMs;
            while (bucket.reservations.length > 0 && bucket.reservations[0].at < cutoff)
                release(bucket);
            const now = timing.now();
            if (bucket.resetAt > 0 && now >= bucket.resetAt) {
                bucket.remaining = bucket.limit > 0 ? bucket.limit : Number.POSITIVE_INFINITY;
                bucket.resetAt = 0;
            }
            const available = bucket.remaining - bucket.reserved;
            const fits = bucket.remaining === Number.POSITIVE_INFINITY ||
                available >= tokens + settings.safetyMarginTokens;
            if (fits) {
                bucket.reserved += tokens;
                bucket.reservations.push({ tokens, at: now });
                log("pass", {
                    need: tokens,
                    available: Number.isFinite(available) ? available : "unbounded",
                    reserved: bucket.reserved,
                    limit: bucket.limit,
                });
                return;
            }
            if (now >= deadline) {
                log("pause limit reached, sending anyway", { available, need: tokens });
                bucket.reserved += tokens;
                bucket.reservations.push({ tokens, at: now });
                return;
            }
            const untilReset = bucket.resetAt > now ? bucket.resetAt - now + 250 : 5_000;
            const wait = Math.max(250, Math.min(untilReset, deadline - now, 15_000));
            log("pausing", {
                waitMs: Math.round(wait),
                available,
                reserved: bucket.reserved,
                need: tokens,
                limit: bucket.limit,
            });
            await timing.sleep(wait, signal);
        }
    });
    bucket.gate = run.catch(() => { });
    return run;
}
