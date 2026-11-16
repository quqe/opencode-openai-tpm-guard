import { closeSync, constants, fchmodSync, fstatSync, ftruncateSync, mkdirSync, openSync, realpathSync, writeSync, } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const NOOP = () => { };
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_FIELD_CHARS = 1_000;
const OPEN_FLAGS = constants.O_APPEND |
    constants.O_CREAT |
    constants.O_WRONLY |
    (constants.O_NOFOLLOW ?? 0) |
    (constants.O_NONBLOCK ?? 0);
/** Private, user-owned state directory; never taken from project configuration. */
function stateDirectory() {
    const base = process.env.XDG_STATE_HOME
        ? join(process.env.XDG_STATE_HOME, "opencode")
        : join(homedir(), ".local", "state", "opencode");
    const dir = join(base, "openai-tpm-guard");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return realpathSync(dir);
}
export function defaultLogFile() {
    return join(stateDirectory(), "debug.log");
}
/** Keep every field on one line and bounded, whatever an error or model id contains. */
function render(value) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return (text ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MAX_FIELD_CHARS);
}
/**
 * Debug logging must never break a model call. The file is private to the user:
 * a fixed state directory, a regular file owned by the current uid, mode 0600,
 * no symlinks, no blocking on a FIFO, and a size cap.
 */
export function createLogger(options) {
    if (!options.debug)
        return NOOP;
    let file;
    try {
        file = defaultLogFile();
    }
    catch {
        return NOOP;
    }
    return (...args) => {
        const line = `[${new Date().toISOString()}] ${args.map(render).join(" ")}\n`;
        try {
            const fd = openSync(file, OPEN_FLAGS, 0o600);
            try {
                const stat = fstatSync(fd);
                const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
                if (!stat.isFile() || (uid !== undefined && stat.uid !== uid))
                    return;
                fchmodSync(fd, 0o600);
                if (stat.size > MAX_LOG_BYTES)
                    ftruncateSync(fd, 0);
                writeSync(fd, line);
            }
            finally {
                closeSync(fd);
            }
        }
        catch {
            // A read-only, missing, or unsafe log path is not worth failing a request over.
        }
    };
}
