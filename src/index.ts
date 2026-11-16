import { Plugin } from "@opencode/plugin"
import { createBucket, observe, release, reserve, type Bucket, type Timing } from "./bucket.js"
import { estimateRequestTokens } from "./estimate.js"
import { readWindow, readWindowFromErrorBody } from "./headers.js"
import { createLogger } from "./log.js"
import { readOptions } from "./options.js"

export const PLUGIN_ID = "openai-tpm-guard"

export { createBucket, observe, release, reserve } from "./bucket.js"
export { estimateRequestTokens } from "./estimate.js"
export { parseDurationMs, parseInteger, readWindow, readWindowFromErrorBody } from "./headers.js"
export { DEFAULT_OPTIONS, readOptions, type GuardOptions } from "./options.js"

interface Shared {
  buckets: Map<string, Bucket>
  requests: WeakSet<object>
  responses: WeakSet<object>
  retries: WeakSet<object>
}

const SHARED_KEY = Symbol.for("opencode.openai-tpm-guard.shared")

/**
 * OpenCode can load one plugin file once per location in the same server process.
 * Shared state makes the extra instances harmless: the first one to see an event
 * handles it, and every instance sees the same token buckets.
 */
const shared: Shared = ((globalThis as Record<symbol, unknown>)[SHARED_KEY] ??= {
  buckets: new Map<string, Bucket>(),
  requests: new WeakSet<object>(),
  responses: new WeakSet<object>(),
  retries: new WeakSet<object>(),
} as Shared) as Shared

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"))
      return
    }
    const finish = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      resolve()
    }
    const abort = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      reject(signal?.reason ?? new Error("aborted"))
    }
    const timer = setTimeout(finish, ms)
    signal?.addEventListener("abort", abort, { once: true })
  })
}

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const options = readOptions(ctx.options)
    if (!options.enabled) return

    const log = createLogger(options)
    const timing: Timing = { now: () => Date.now(), sleep }
    const bucketFor = (modelID: string) => {
      const key = `${options.providerID}:${modelID}`
      let bucket = shared.buckets.get(key)
      if (!bucket) {
        bucket = createBucket()
        shared.buckets.set(key, bucket)
      }
      return bucket
    }

    log("setup", { version: ctx.app.version, providerID: options.providerID })

    const responseHook = await ctx.session.hook(
      "http.response",
      (event) => {
        if (shared.responses.has(event.response)) return
        shared.responses.add(event.response)

        const bucket = bucketFor(event.model.id)
        release(bucket)
        observe(
          bucket,
          readWindow(event.response.headers),
          event.response.status,
          timing.now(),
          options.minRetryDelayMs,
        )

        if (event.response.status === 429) {
          log("429", { model: event.model.id, resetAt: bucket.resetAt - timing.now() })
        } else if (bucket.limit > 0) {
          log("window", {
            model: event.model.id,
            limit: bucket.limit,
            remaining: bucket.remaining,
            resetMs: Math.max(0, bucket.resetAt - timing.now()),
          })
        }
      },
      { providerID: options.providerID },
    )

    const requestHook = await ctx.session.hook(
      "http.request",
      async (event) => {
        if (shared.requests.has(event.request)) return
        shared.requests.add(event.request)

        const bucket = bucketFor(event.model.id)
        const tokens = await estimateRequestTokens(event.request, options.tokensPerChar)
        try {
          await reserve(bucket, tokens, event.request.signal, options, timing, log)
        } catch (error) {
          if (event.request.signal.aborted) throw error
          // Never block a real request because the guard itself failed.
          log("guard error", { message: String(error) })
        }
      },
      { providerID: options.providerID },
    )

    const retryHook = await ctx.session.hook(
      "retry",
      (event) => {
        if (shared.retries.has(event)) return
        shared.retries.add(event)

        const error = event.error
        if (error.type !== "provider.rate-limit" && error.status !== 429) return

        const bucket = bucketFor(event.model.id)
        const body = readWindowFromErrorBody(error.response?.body)
        const now = timing.now()
        const observed = Math.max(0, bucket.resetAt - now)
        const delay = Math.min(
          options.maxRetryDelayMs,
          Math.max(
            options.minRetryDelayMs,
            observed,
            body.resetMs ?? 0,
            body.retryAfterMs ?? 0,
            error.retryAfterMs ?? 0,
          ),
        )
        const jittered = Math.round(delay * (1 + Math.random() * 0.15))

        bucket.remaining = 0
        bucket.resetAt = now + jittered
        event.decision = { retry: true, delay: jittered }
        log("retry", { model: event.model.id, attempt: event.attempt, delayMs: jittered })
      },
      { providerID: options.providerID },
    )

    return async () => {
      await requestHook.dispose()
      await responseHook.dispose()
      await retryHook.dispose()
    }
  },
})
