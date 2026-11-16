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

## Security

- The plugin never reads `Authorization` and never sends data anywhere. It does not log prompts or bodies.
- Request bodies are read from a clone only to estimate their size; the bytes are not stored. Bodies larger than 16 MB
  are measured from `Content-Length`; without it, at most 4 MB is read and the clone is cancelled.
- The debug log lives in a fixed private directory (`$XDG_STATE_HOME/opencode/openai-tpm-guard`), is opened with
  `O_NOFOLLOW | O_NONBLOCK`, must be a regular file owned by the current uid, is kept at mode `0600`, and is truncated
  at 5 MB. Fields are stripped of control characters and bounded. Project configuration cannot choose the path.
- Reservations are keyed by the request object, so a late or foreign response cannot release someone else's budget. An
  aborted request releases its own reservation.
- Every hook body is wrapped: a guard bug is logged (with `debug` on) and never fails a model call.

## Requirements

- OpenCode 2.3 or newer (`@opencode/plugin` >= 2.3.0).
- OpenAI over the regular HTTPS request transport. See [Transport](#transport).
- The plugin only sees rate-limit headers when requests go through `http.request`/`http.response` hooks.

## Install

### From GitHub

OpenCode installs GitHub packages directly:

```sh
opencode plugin add github:quqe/opencode-openai-tpm-guard
```

Or add it to your global `~/.config/opencode/opencode.json(c)` yourself:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "github:quqe/opencode-openai-tpm-guard",
      "options": { "debug": true }
    }
  ]
}
```

Pin a release with `github:quqe/opencode-openai-tpm-guard#v0.1.3`. The built `dist/` is committed, so no build step is
needed.

### From a local checkout

```sh
git clone https://github.com/quqe/opencode-openai-tpm-guard.git
cd opencode-openai-tpm-guard
npm install   # installs dev dependencies and builds dist/ through prepare
```

Then point the config at the checkout. An absolute path works; a relative path resolves from the config file that
contains it:

```jsonc
"plugins": [
  {
    "package": "/path/to/opencode-openai-tpm-guard",
    "options": { "debug": true }
  }
]
```

OpenCode reloads configuration and local plugins automatically.

### Verify

```sh
opencode plugin list
```

The plugin appears as `openai-tpm-guard`. Do not also copy the entry file into `~/.config/opencode/plugins/`: that
directory is auto-discovered, so the plugin would load twice. Duplicate instances are harmless (the guard deduplicates
events), but the extra copy is redundant.

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
| `debug` | `false` | Write pacing and 429 diagnostics to the private state log. |

Invalid values fall back to defaults or are clamped, so a typo cannot produce `NaN` delays. `maxWaitMs`,
`maxRetryDelayMs` and `reservationTtlMs` are capped at ten minutes, and token margins at two million.

## Logs

With `debug: true`, records go to `$XDG_STATE_HOME/opencode/openai-tpm-guard/debug.log` (default
`~/.local/state/opencode/openai-tpm-guard/debug.log`). The file is private to the current user, created with mode `0600`,
written without following symlinks, and truncated when it grows past 5 MB.

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
  A body without `Content-Length` is read up to 4 MB, so a larger chunked body is measured from its prefix. Large bodies
  measured from `Content-Length` overestimate non-ASCII text, which errs on the safe side.
- Declared output budgets are clamped to two million tokens; a malformed number cannot poison the window.
- OpenCode's retry budget is a hard limit of 10 attempts. The plugin changes delays, not the budget.
- Pauses happen inside OpenCode's request path, before the request is sent, so they do not compete with
  `headerTimeout`/`chunkTimeout` the way a blocked response would.
- A pause longer than `maxWaitMs` is abandoned: the request is sent and the ordinary 429 retry path takes over.
- Gate decisions are serialized per model, but only the check-and-claim step. A paused request does not block other
  requests for the same model; requests for other models are fully independent.
- A reservation whose request never responds and never aborts is released after `reservationTtlMs` (2 minutes).

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
