import type { GuardOptions } from "./options.js";
export type Logger = (...args: unknown[]) => void;
export declare function defaultLogFile(): string;
/**
 * Debug logging must never break a model call. The file is private to the user:
 * a fixed state directory, a regular file owned by the current uid, mode 0600,
 * no symlinks, no blocking on a FIFO, and a size cap.
 */
export declare function createLogger(options: GuardOptions): Logger;
