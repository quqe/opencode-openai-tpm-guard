# opencode-openai-tpm-guard

An [OpenCode](https://opencode.ai) 2 plugin that makes the **OpenAI** provider rate-limit aware: it reads the
`x-ratelimit-*-tokens` headers of every response, pauses a request when the minute's token budget has no room for it,
and makes 429 retries wait for the token window instead of only `retry-after`.

It applies to one provider (`openai` by default). Every other provider is untouched.

## Why

OpenAI meters **tokens per minute** (TPM) per model. A single agent step resends the whole prompt, so a long session can
produce requests of several hundred thousand tokens. Two of those in one minute exhaust a 1M TPM budget, and a retry
that only honours `retry-after` can fire before `x-ratelimit-reset-tokens`, re-consuming the window and looping.

A real failure this plugin was written for:

```
TPM Limit 1 000 000, Used 760 023, Requested 570 950
retry-after: 20s, x-ratelimit-reset-tokens: 45.6s
```

`760k + 570k > 1M`, so OpenCode's built-in retry (2→10s exponential, honours `retry-after`) kept retrying too early.

## What it does

Four registrations, all scoped to the configured provider:

1. **`http.response`** — parses `x-ratelimit-limit-tokens`, `-remaining-tokens` and `-reset-tokens`.
2. **`http.request`** — estimates the request size (serialized body length + reserved output) and waits until the window
   has room. Pauses are chunked and cancellable; the session is never interrupted.
3. **`retry`** — on `429` sets the retry delay from the token reset (falling back to `retry-after`), capped at
   `maxRetryDelayMs`.
4. **Concurrency** — reservations are shared per model, so subagents, title generation and compaction all count against
   the same budget.

State is in memory, per model. Nothing is written to disk unless `debug` is enabled, and the debug log contains only
model IDs, token numbers and timings — never prompts, bodies or credentials.

## Requirements

- OpenCode 2.3 or newer (`@opencode/plugin` >= 2.3.0).
- OpenAI over the regular HTTPS request transport. See [Transport](#transport).
- The plugin only sees rate-limit headers when requests go through `http.request`/`http.response` hooks.

## Install

The plugin is a package with a built `dist/`. Build it once:

```sh
npm install
npm run build
```

Then load the directory from your global `~/.config/opencode/opencode.json(c)`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/code/opencode-openai-tpm-guard",
      "options": { "debug": true }
    }
  ]
}
```

An absolute path works; a relative path resolves from the config file that contains it. OpenCode reloads config and
local plugins automatically.

## Transport

OpenCode defaults the OpenAI provider to a WebSocket transport. WebSocket traffic does not pass through the HTTP hooks,
so the plugin cannot see the rate-limit headers and cannot pace requests. Disable it for OpenAI only:

```jsonc
{
  "providers": {
    "openai": {
      "settings": { "transport": "http" }
    }
  }
}
```

Both transports use TLS (`wss://` and `https://`); this setting changes the delivery mechanism, not the encryption.
Other providers keep their own transport.

## Recommended companion settings

Pacing alone cannot help when one request is larger than the whole minute. Cap the input window so compaction happens
before the request reaches the TPM wall (and before OpenAI's higher price tier at 272k context):

```jsonc
{
  "compaction": { "keep": { "tokens": 40000 } },
  "providers": {
    "openai": {
      "settings": { "transport": "http" },
      "models": {
        "gpt-6.1-terra": {
          "limit": { "context": 328000, "input": 200000, "output": 128000 }
        }
      }
    }
  }
}
```

With `input: 200000`, automatic compaction triggers at about 170k (`200k − 15%` reserve), and requests stay below the
272k price tier. Adjust the number to your model and plan.

## Options

Pass them on the plugin entry in `opencode.json(c)`.

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch. |
| `providerID` | `"openai"` | Provider the guard applies to. |
| `tokensPerChar` | `0.3` | Rough tokens per character of the serialized body (code ~0.25, Cyrillic ~0.4). |
| `safetyMarginTokens` | `30000` | Headroom kept free so an estimate miss does not become a 429. |
| `maxWaitMs` | `300000` | Longest single pause before a request is sent anyway. |
| `minRetryDelayMs` | `2000` | Never retry a rate limit faster than this. |
| `maxRetryDelayMs` | `120000` | Longest retry delay asked from OpenCode. |
| `reservationTtlMs` | `120000` | Release a reservation this old (aborted request). |
| `debug` | `false` | Write pacing and 429 diagnostics. |
| `logFile` | `"/tmp/opencode/openai-tpm-guard.log"` | Debug destination; `null` writes to stderr. |

Invalid values fall back to defaults or are clamped, so a typo cannot produce `NaN` delays.

## Logs

With `debug: true`:

```text
pass    {"need":11023,"available":2000000,"reserved":11023,"limit":2000000}
window  {"model":"gpt-6.1-luna","limit":2000000,"remaining":1991884,"resetMs":243}
pausing {"waitMs":15000,"available":120000,"reserved":0,"need":200000,"limit":1000000}
retry   {"model":"gpt-6.1-terra","attempt":2,"delayMs":46000}
429     {"model":"gpt-6.1-terra","resetAt":45601}
```

When everything is healthy you mostly see `pass` and `window`, rare `pausing`, and almost no `retry`/`429`.

## Caveats

- The request size is an estimate, not a tokenizer. The safety margin absorbs the error; the retry hook covers misses.
- OpenCode's retry budget is a hard limit of 10 attempts. The plugin changes delays, not the budget.
- Pauses happen inside OpenCode's request path, before the request is sent, so they do not compete with
  `headerTimeout`/`chunkTimeout` the way a blocked response would.
- A pause longer than `maxWaitMs` is abandoned: the request is sent and the ordinary 429 retry path takes over.

## Development

```sh
npm install
npm run build      # tsc -> dist/
npm test           # build + node --test
npm run typecheck
```

Source layout:

- `src/headers.ts` — header and duration parsing.
- `src/estimate.ts` — request size estimate.
- `src/bucket.ts` — per-model window state, reservations and pauses.
- `src/options.ts` — option validation.
- `src/index.ts` — OpenCode hooks.
- `test/` — unit tests for parsing and pacing.

## License

MIT
