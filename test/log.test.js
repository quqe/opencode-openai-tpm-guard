import assert from "node:assert/strict"
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { createLogger } from "../dist/log.js"
import { DEFAULT_OPTIONS } from "../dist/options.js"

function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), "tpm-guard-log-"))
  const old = process.env.XDG_STATE_HOME
  process.env.XDG_STATE_HOME = dir
  try {
    run(dir, join(dir, "opencode", "openai-tpm-guard"))
  } finally {
    if (old === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = old
    rmSync(dir, { recursive: true, force: true })
  }
}

test("logging rejects hard-linked files without changing their contents or mode", () => {
  fixture((dir, logDir) => {
    mkdirSync(logDir, { recursive: true, mode: 0o700 })
    const target = join(dir, "sensitive")
    writeFileSync(target, "secret", { mode: 0o644 })
    linkSync(target, join(logDir, "debug.log"))
    createLogger({ ...DEFAULT_OPTIONS, debug: true })("test")
    assert.equal(readFileSync(target, "utf8"), "secret")
    assert.equal(statSync(target).mode & 0o777, 0o644)
  })
})

test("logging rejects symlinked and non-private log directories", () => {
  fixture((dir, logDir) => {
    mkdirSync(join(dir, "opencode"), { mode: 0o700 })
    const target = join(dir, "target")
    mkdirSync(target, { mode: 0o700 })
    symlinkSync(target, logDir)
    createLogger({ ...DEFAULT_OPTIONS, debug: true })("test")
    assert.throws(() => statSync(join(target, "debug.log")), { code: "ENOENT" })
  })
  fixture((_dir, logDir) => {
    mkdirSync(logDir, { recursive: true, mode: 0o755 })
    createLogger({ ...DEFAULT_OPTIONS, debug: true })("test")
    assert.throws(() => statSync(join(logDir, "debug.log")), { code: "ENOENT" })
  })
})

test("logging uses a private file and rejects a symlinked log file", () => {
  fixture((dir, logDir) => {
    const log = createLogger({ ...DEFAULT_OPTIONS, debug: true })
    log("hello")
    const file = join(logDir, "debug.log")
    assert.match(readFileSync(file, "utf8"), /hello/)
    assert.equal(statSync(file).mode & 0o777, 0o600)
    rmSync(file)
    const target = join(dir, "target")
    writeFileSync(target, "untouched")
    symlinkSync(target, file)
    log("must not be written")
    assert.equal(readFileSync(target, "utf8"), "untouched")
  })
})

test("logging errors never escape to the caller", () => {
  fixture(() => {
    const log = createLogger({ ...DEFAULT_OPTIONS, debug: true })
    const cyclic = {}
    cyclic.self = cyclic
    assert.doesNotThrow(() => log(cyclic))
  })
})
