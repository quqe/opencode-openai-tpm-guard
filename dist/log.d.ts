import type { GuardOptions } from "./options.js";
export type Logger = (...args: unknown[]) => void;
/** Debug logging must never break a model call. */
export declare function createLogger(options: GuardOptions): Logger;
