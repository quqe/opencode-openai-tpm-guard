import { closeSync, constants, openSync, writeSync } from "node:fs"
import type { GuardOptions } from "./options.js"

export type Logger = (...args: unknown[]) => void

const NOOP: Logger = () => {}

/** Do not follow symlinks: the log path may live in a shared directory. */
const OPEN_FLAGS =
  constants.O_APPEND |
  constants.O_CREAT |
  constants.O_WRONLY |
  ((constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0)

/** Debug logging must never break a model call. */
export function createLogger(options: GuardOptions): Logger {
  if (!options.debug) return NOOP
  if (options.logFile === null) {
    return (...args) => console.error("[openai-tpm-guard]", ...args)
  }
  const file = options.logFile
  return (...args) => {
    const line = `[${new Date().toISOString()}] ${args
      .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
      .join(" ")}\n`
    try {
      const fd = openSync(file, OPEN_FLAGS, 0o600)
      try {
        writeSync(fd, line)
      } finally {
        closeSync(fd)
      }
    } catch {
      // A read-only, missing, or symlinked log path is not worth failing a request over.
    }
  }
}
