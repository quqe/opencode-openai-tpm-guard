import { appendFileSync } from "node:fs";
const NOOP = () => { };
/** Debug logging must never break a model call. */
export function createLogger(options) {
    if (!options.debug)
        return NOOP;
    if (options.logFile === null) {
        return (...args) => console.error("[openai-tpm-guard]", ...args);
    }
    const file = options.logFile;
    return (...args) => {
        const line = `[${new Date().toISOString()}] ${args
            .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
            .join(" ")}\n`;
        try {
            appendFileSync(file, line);
        }
        catch {
            // A read-only or missing log directory is not worth failing a request over.
        }
    };
}
