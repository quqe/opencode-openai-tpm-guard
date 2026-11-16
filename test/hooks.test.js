import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import plugin from "../dist/index.js"

async function setup(options = {}) {
  const hooks = {}
  const dispose = await plugin.setup({
    options,
    app: { version: "test" },
    session: {
      async hook(name, handler) {
        hooks[name] = handler
        return { async dispose() {} }
      },
    },
  })
  return { hooks, dispose }
}

test("retry does not shorten a host delay or override a terminal decision", async () => {
  const { hooks, dispose } = await setup()
  const event = {
    model: { id: "retry-host-test" },
    error: { type: "provider.rate-limit", status: 429 },
    attempt: 1,
    decision: { retry: true, delay: 300_000 },
  }
  hooks.retry(event)
  assert.equal(event.decision.delay, 300_000)
  const terminal = { ...event, decision: { retry: false } }
  hooks.retry(terminal)
  assert.deepEqual(terminal.decision, { retry: false })
  await dispose()
})

test("invalid retry delays do not poison retry decisions", async () => {
  const { hooks, dispose } = await setup()
  const event = {
    model: { id: "retry-nan-test" },
    error: { type: "provider.rate-limit", status: 429, retryAfterMs: NaN },
    attempt: 1,
    decision: { retry: true, delay: 100 },
  }
  hooks.retry(event)
  assert.ok(Number.isFinite(event.decision.delay))
  assert.ok(event.decision.delay >= 2_000)
  await dispose()
})

test("hook errors do not leak arbitrary exception text into debug logs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tpm-guard-hook-"))
  const old = process.env.XDG_STATE_HOME
  process.env.XDG_STATE_HOME = dir
  try {
    const { hooks, dispose } = await setup({ debug: true })
    hooks["http.response"]({
      model: { id: "error-log-test" },
      request: {},
      response: { get headers() { throw new Error("secret-prompt-and-key") } },
    })
    const contents = readFileSync(join(dir, "opencode", "openai-tpm-guard", "debug.log"), "utf8")
    assert.match(contents, /guard error/)
    assert.doesNotMatch(contents, /secret-prompt-and-key/)
    await dispose()
  } finally {
    if (old === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = old
    rmSync(dir, { recursive: true, force: true })
  }
})
