import { Plugin } from "@opencode/plugin";
export declare const PLUGIN_ID = "openai-tpm-guard";
export { createBucket, observe, release, reserve } from "./bucket.js";
export { estimateRequestTokens } from "./estimate.js";
export { parseDurationMs, parseInteger, parseRetryAfter, readWindow, readWindowFromErrorBody, } from "./headers.js";
export { DEFAULT_OPTIONS, readOptions, type GuardOptions } from "./options.js";
declare const _default: Plugin.Plugin;
export default _default;
