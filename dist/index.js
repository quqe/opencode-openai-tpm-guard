import { Plugin } from "@opencode/plugin";
import { createBucket, observe, release, reserve } from "./bucket.js";
import { estimateRequestTokens } from "./estimate.js";
import { readWindow, readWindowFromErrorBody } from "./headers.js";
import { createLogger } from "./log.js";
import { readOptions } from "./options.js";
export const PLUGIN_ID = "openai-tpm-guard";
export { createBucket, observe, release, reserve } from "./bucket.js";
export { estimateRequestTokens } from "./estimate.js";
export { parseDurationMs, parseInteger, parseRetryAfter, readWindow, readWindowFromErrorBody, } from "./headers.js";
export { DEFAULT_OPTIONS, readOptions } from "./options.js";
const SHARED_KEY = Symbol.for("opencode.openai-tpm-guard.shared.v2");
/**
 * OpenCode can load one plugin file once per location in the same server process.
 * Shared state makes the extra instances harmless: the first one to see an event
 * handles it, and every instance sees the same token buckets.
 */
const shared = (globalThis[SHARED_KEY] ??= {
    buckets: new Map(),
    requests: new WeakSet(),
    responses: new WeakSet(),
    retries: new WeakSet(),
});
function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason ?? new Error("aborted"));
            return;
        }
        const finish = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            resolve();
        };
        const abort = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            reject(signal?.reason ?? new Error("aborted"));
        };
        const timer = setTimeout(finish, ms);
        signal?.addEventListener("abort", abort, { once: true });
    });
}
export default Plugin.define({
    id: PLUGIN_ID,
    async setup(ctx) {
        const options = readOptions(ctx.options);
        if (!options.enabled)
            return;
        const log = createLogger(options);
        const timing = { now: () => Date.now(), sleep };
        const bucketFor = (modelID) => {
            const key = `${options.providerID}:${modelID}`;
            const bucket = shared.buckets.get(key);
            const valid = bucket !== undefined &&
                bucket.reservations instanceof Map &&
                Number.isFinite(bucket.reserved) &&
                Number.isFinite(bucket.limit) &&
                Number.isFinite(bucket.resetAt) &&
                (bucket.remaining === Number.POSITIVE_INFINITY || Number.isFinite(bucket.remaining));
            if (!valid) {
                // A reload or a malformed value must not leave a poisoned bucket behind.
                const fresh = createBucket();
                shared.buckets.set(key, fresh);
                return fresh;
            }
            return bucket;
        };
        log("setup", { version: ctx.app.version, providerID: options.providerID });
        const responseHook = await ctx.session.hook("http.response", (event) => {
            if (shared.responses.has(event))
                return;
            shared.responses.add(event);
            try {
                const bucket = bucketFor(event.model.id);
                release(bucket, event.request);
                observe(bucket, readWindow(event.response.headers), event.response.status, timing.now(), options.minRetryDelayMs);
                if (event.response.status === 429) {
                    log("429", { model: event.model.id, resetAt: bucket.resetAt - timing.now() });
                }
                else if (bucket.limit > 0) {
                    log("window", {
                        model: event.model.id,
                        limit: bucket.limit,
                        remaining: bucket.remaining,
                        resetMs: Math.max(0, bucket.resetAt - timing.now()),
                    });
                }
            }
            catch (error) {
                log("guard error", { hook: "http.response", message: String(error) });
            }
        }, { providerID: options.providerID });
        const requestHook = await ctx.session.hook("http.request", async (event) => {
            if (shared.requests.has(event))
                return;
            shared.requests.add(event);
            try {
                const bucket = bucketFor(event.model.id);
                const tokens = await estimateRequestTokens(event.request, options.tokensPerChar);
                await reserve(bucket, tokens, event.request, event.request.signal, options, timing, log);
            }
            catch (error) {
                if (event.request.signal.aborted)
                    throw error;
                // Never block a real request because the guard itself failed.
                log("guard error", { hook: "http.request", message: String(error) });
            }
        }, { providerID: options.providerID });
        const retryHook = await ctx.session.hook("retry", (event) => {
            if (shared.retries.has(event))
                return;
            shared.retries.add(event);
            try {
                const error = event.error;
                if (error.type !== "provider.rate-limit" && error.status !== 429)
                    return;
                const bucket = bucketFor(event.model.id);
                const body = readWindowFromErrorBody(error.response?.body);
                const now = timing.now();
                const observed = Math.max(0, bucket.resetAt - now);
                const delay = Math.min(options.maxRetryDelayMs, Math.max(options.minRetryDelayMs, observed, body.resetMs ?? 0, body.retryAfterMs ?? 0, error.retryAfterMs ?? 0));
                const jittered = Math.min(options.maxRetryDelayMs, Math.round(delay * (1 + Math.random() * 0.15)));
                bucket.remaining = 0;
                bucket.resetAt = now + jittered;
                // Extend the host's delay, never override a terminal decision.
                if (event.decision.retry === true) {
                    event.decision = { retry: true, delay: jittered };
                    log("retry", { model: event.model.id, attempt: event.attempt, delayMs: jittered });
                }
                else {
                    log("retry exhausted", { model: event.model.id, attempt: event.attempt });
                }
            }
            catch (error) {
                log("guard error", { hook: "retry", message: String(error) });
            }
        }, { providerID: options.providerID });
        return async () => {
            await requestHook.dispose();
            await responseHook.dispose();
            await retryHook.dispose();
        };
    },
});
