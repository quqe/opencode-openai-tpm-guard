# Security policy

## Supported versions

Only the latest `0.1.x` release is supported. Pin the tag you run:

```jsonc
"plugins": [{ "package": "github:quqe/opencode-openai-tpm-guard#v0.1.3" }]
```

## Reporting a vulnerability

Use GitHub's private vulnerability reporting (Security → Report a vulnerability) or open a private security advisory.
Do not paste API keys, tokens, prompts, or full request bodies into an issue. If a report needs provider output, redact
identifiers and account details first.

## Threat model

The plugin runs inside the OpenCode server with that process's privileges. It is not a sandbox and is not a security
boundary between projects.

- **Trusted:** the user's global configuration, the OpenCode server, the configured provider (including a custom
  `baseURL` you set deliberately).
- **Untrusted:** project configuration, repository contents, model output, and HTTP header or body values returned by a
  provider or proxy.

The plugin is designed so that untrusted values can at most change pacing decisions. They cannot write files, choose a
log path, execute commands, or read credentials.

## What the plugin does with data

- Never reads `Authorization` and never sends data anywhere.
- Reads a bounded prefix of request bodies (at most 4 MB and one second) only to estimate size. Prompts, bodies and
  exception text are not logged or persisted.
- Writes debug records only to a fixed private state directory (`$XDG_STATE_HOME/opencode/openai-tpm-guard`) with a
  private-directory, regular-file, owner, mode, symlink, hard-link, and size check. Fields are stripped of control
  characters and truncated. This is not a boundary against processes running as the same user.
- Catches every hook error, so a defect in the guard cannot fail a model call.

## Supply chain

- Runtime dependencies: none. `@opencode/plugin` is a peer provided by OpenCode; dev dependencies are for the build
  only.
- The root npm overrides for `glob` and `minimatch` address advisories in the local development dependency tree.
  They cross upstream major-version constraints and are covered by compatibility smoke tests. npm does not apply a
  dependency package's overrides to its consumer, so these overrides do not patch the OpenCode host's own dependencies.
- CI audits dependencies, runs the tests and fails if the committed `dist/` differs from `src/`.
- Install from a pinned tag in production. Enable 2FA and branch protection on the repository; anyone with push access
  can change code that runs with the OpenCode server's privileges.
