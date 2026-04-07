# Cape — CLI Application Plugin Engine

## The Problem

Building a CLI tool starts simple — a few commands, some flags, some config. But as your organization grows, it becomes a bottleneck. The platform team wants a `deploy` command; the data team wants a `sync` command; the security team wants an `audit` command — all with different owners, all waiting on the same repo. Feature teams send PRs for changes the tooling team didn’t ask for and can’t prioritize. Eventually someone forks the CLI, and now you have two. Then three.

The standard answer — yargs or commander with some ad-hoc plugin mechanism bolted on — works until it doesn’t.

-----

## What Cape Is

Cape is a TypeScript CLI framework built around a single premise: the plugin system shouldn’t be an afterthought bolted onto a core tool — it should be the foundation everything else is built on.

That means two kinds of engineers get a great experience: the tooling team that owns and ships the CLI, and the feature teams that extend it for their own workflows — without waiting on anyone.

-----

## What’s Unique

**1. Plugins and built-in commands are the same thing**

A plugin is just a command that lives outside the core repo — same API, same types, same runtime. This means the boundary between “built-in” and “plugin” is a deployment decision, not an architectural one.

A feature team can prototype a new workflow as a plugin in their repo. If it proves broadly useful, the tooling team promotes it to a built-in by moving the file. The reverse works too — a built-in that only one team uses gets extracted into their repo as a plugin. No refactoring, no interface changes.

**2. No external build tools, anywhere in the chain**

Cape runs TypeScript directly — no transpilation step in development, no separate compiler to configure or version-pin. `cape run` starts instantly; `cape build` compiles to a single self-contained binary. Feature teams write plugins as plain `.ts` files, and the CLI picks them up automatically.

Types flow through the same mechanism: the CLI itself generates the type definitions feature teams need to write typed plugins. No separate type-generation pipeline, no build step in the plugin repo — just run one command and get full IDE support.

**3. A runtime, not just parsed args**

Every command — built-in or plugin — gets the same `runtime` object: a consistent, pre-wired toolkit for prompts, HTTP, secrets, output, filesystem, and process execution. This isn’t just convenient. It means every command handles cancellation the same way, formats output the same way, and accesses credentials the same way — regardless of who wrote it or where it lives.

It also makes commands dramatically easier to test. Because all side effects go through `runtime`, you swap in a test implementation and your command logic runs without touching the network, the filesystem, or a real credential store. Plugin authors get the same testability as built-in commands, for free.

**4. Great DX for the feature team**

A plugin is a `.ts` file and a small manifest. Drop it in the right directory; it appears in the CLI at next invocation — no registration, no publish step, no version pinning. Feature teams write commands with the same API and the same type safety as built-in commands, with real IDE support for `runtime.config` typed to the specific CLI they’re extending.

This means feature teams can own their workflows end-to-end: write the command, iterate on it, and decide with the tooling team whether it belongs in the core.

**5. The tooling to ship a CLI, not just the API to build one**

Most CLI frameworks hand you primitives and leave the rest to you. Cape ships a meta-CLI — `cape init`, `cape run`, `cape build`, `cape command add` — that handles scaffolding, development workflow, and compiling to a distributable binary. The tooling team isn’t stitching together a build pipeline; they’re defining commands and shipping them.

-----

## The Gains

**For the tooling team**: Ship a core CLI with a clear extension model. Feature teams add their own commands without PRs to your repo. Promotion from plugin to built-in (and back) is a file move, not a refactor.

**For the feature team**: Own your workflows end-to-end. Write a typed command in your repo, extend the shared CLI, and iterate without waiting on the tooling team.

**For everyone**: One consistent runtime across all commands — built-in or plugin — means cancellation, output formatting, credentials, and JSON mode just work, regardless of who wrote the command or where it lives.

-----

## Where It Fits

Engineers today expect their tools to just work — fast feedback, good error messages, real IDE support, consistent behaviour. That bar, once reserved for polished open-source developer tools, now applies to internal tooling too. Teams notice when the internal CLI feels cobbled together.

Cape is how you build the internal CLI that meets that bar — and keeps meeting it as your organization grows and more teams want to extend it.
