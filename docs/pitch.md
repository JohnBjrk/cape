# Cape — CLI Application Plugin Engine

## The Problem

Building a CLI tool starts simple — a few commands, some flags, some config. But as your organization grows and workflows diversify, the cracks show:

- The platform team wants a `deploy` command; the data team wants a `sync` command; the security team wants an `audit` command — all in the same tool, all with different owners
- A feature team needs to hook into the release workflow from their own repo, without sending a PR to the tooling team
- The CLI accumulates commands nobody can agree on, or shadow forks start appearing

The standard answer — yargs or commander with some ad-hoc plugin mechanism bolted on — works until it doesn't.

---

## What Cape Is

Cape is a TypeScript/Bun CLI framework where the plugin system isn't an afterthought — it's the central design premise.

The key distinction Cape is built around: two teams interact with any serious internal CLI differently:

- **The tooling team** — owns and maintains `mycli`; defines the core commands, config schema, and credential model
- **The feature team** — uses `mycli` in their daily workflow; has repo-specific commands and automation they want to add without depending on the tooling team for every change

Cape is designed to give both teams a great experience — building the CLI and extending it.

---

## What's Unique

**1. Plugins and built-in commands are the same thing**

A plugin is just a command that lives outside the core repo — same API, same types, same runtime. This means the boundary between "built-in" and "plugin" is a deployment decision, not an architectural one.

A feature team can prototype a new workflow as a plugin in their repo. If it proves broadly useful, the tooling team promotes it to a built-in by moving the file. The reverse works too — a built-in that only one team uses gets extracted into their repo as a plugin. No refactoring, no interface changes.

**2. No external build tools, anywhere in the chain**

Cape is Bun-native. TypeScript runs directly — no transpilation step in development, no separate compiler to configure or version-pin. `cape run` starts instantly; `cape build` compiles to a single self-contained binary. Feature teams write plugins as plain `.ts` files, and the CLI picks them up automatically.

Types flow through the same mechanism: the CLI itself generates the type definitions feature teams need to write typed plugins. No separate type-generation pipeline, no build step in the plugin repo — just run one command and get full IDE support.

**3. Great DX for the tooling team**

Cape gives the tooling team a `runtime` object instead of just parsed args — every command gets the same consistent toolkit:

| `runtime.prompt` | text, autocomplete, select, multi-select, confirm |
|---|---|
| `runtime.http` | JSON-first HTTP client |
| `runtime.exec` | shell/process execution |
| `runtime.fs` | filesystem with XDG-compliant paths |
| `runtime.secrets` | credential store, cross-command access |
| `runtime.output` | tables, spinners, progress bars, `--json` mode |
| `runtime.signal` | AbortSignal wired to Ctrl+C, threaded into all async APIs |

Config schemas are declared once and flow as types into `runtime.config` everywhere — no casting. The meta-CLI (`cape init`, `cape run`, `cape build`, `cape command add`) handles the scaffolding and distribution so the tooling team ships structure, not just scripts.

**4. Great DX for the feature team**

A plugin is a `.ts` file and a small manifest. Drop it in the right directory; it appears in the CLI at next invocation — no registration, no npm publish, no version pinning. The feature team writes commands with the same API and the same type safety as built-in commands. They get real IDE support for `runtime.config` typed to the specific CLI they're extending.

This isn't just convenient — it means feature teams can own their workflows end-to-end: write the command, iterate on it, and decide with the tooling team whether it belongs in the core.

**5. Config that understands the monorepo boundary**

Cape has a two-layer config model out of the box: `~/.config/mycli/config.toml` for global settings, `.mycli.toml` at the repo root for local overrides. The repo-local file wins per-section. Infrastructure settings like which plugin directories to scan live in a framework-reserved section — never leaked to command code.

---

## The Gains

**For the tooling team**: Ship a core CLI with a clear extension model. Feature teams add their own commands without PRs to your repo. Promotion from plugin to built-in (and back) is a file move, not a refactor.

**For the feature team**: Own your workflows end-to-end. Write a typed command in your repo, extend the shared CLI, and iterate without waiting on the tooling team.

**For everyone**: One consistent runtime across all commands — built-in or plugin — means cancellation, output formatting, credentials, and JSON mode just work, regardless of who wrote the command or where it lives.

---

## Where It Fits

Cape is for organizations that have — or are building — a shared internal developer CLI that needs to evolve across multiple teams. The reference point is the platform CLI that every engineering team installs and, eventually, starts extending for their own workflows.
