# Implementation Plan

Ordered for fastest path to a runnable system. Each phase ends with a playable checkpoint so design problems surface early.

Progress: `[ ]` not started · `[x]` done · `[-]` in progress

**Revised execution order:** Phase 1 → Phase 2 → Phase 4 (Completions) → Phase 5 (Interactive Prompt) → Phase 7 subset (defineConfig + binary) → Phase 3 (Full Runtime) → Phase 6 (Built-ins) → Phase 7 rest → Phase 8

---

## Phase 1 — Arg Parser + Bare Runtime ✓

**Goal:** write a command by hand, run it, see help text. No plugin discovery yet — just wire one command directly.

- [x] Arg parser: token stream (`flag | value | separator`)
- [x] Arg parser: resolve tokens against `ArgSchema` (flags, positionals, `--` passthrough)
- [x] Arg parser: flag clustering (`-abc` → `-a -b -c`), `--flag=value` and `--flag value` forms
- [x] Arg parser: `required`, `multiple`, `default` on flags
- [x] Validation errors: unknown flag, wrong type, missing required, did-you-mean for typos (exit code 2)
- [x] `Runtime` interface + `MockRuntime` (args, env, print, printError, exit — bare minimum)
- [x] Global flags: `--help/-h`, `--json`, `--no-color`, `--quiet/-q`, `--verbose/-v`, `--debug`
- [x] Help text renderer: top-level, command, and subcommand levels from schema
- [x] Wire one hardcoded command end-to-end: manifest → arg parse → run

**Checkpoint:** write a `hello` command with a `--name` flag. Run it, get help with `--help`, see a validation error with `--unknown-flag`. Confirm the design feels right before building the loader.

---

## Phase 2 — Plugin Loader + Subcommand Routing ✓

**Goal:** commands are discovered automatically from the filesystem — no hardcoding.

- [x] `*.plugin.toml` minimal manifest format (`name`, `description`, `command`, `enabled`, `frameworkVersion`)
- [x] Plugin discovery: recursive scan of configured directories
- [ ] Plugin directories: project-local (`./commands/`), user (`~/.config/<cli>/plugins/`), config-defined paths (deferred to Phase 3 — config loading)
- [x] Subcommand routing: two-level dispatch (`cli → command → subcommand`), arg scope rules
- [x] Execution mode: `executionMode` export (`"run" | "complete"`) set before dynamic import
- [x] Plugin compatibility check: semver major mismatch → hard error at load time
- [ ] Versioned types: `CommandManifestV1`, `RuntimeV1` (deferred to Phase 8 — hardening)

**Checkpoint:** drop a `*.plugin.toml` + TS file into `./commands/`, run the CLI, have the command appear and work. Try adding a second command and a subcommand. Does the plugin authoring experience feel right?

---

## Phase 4 — Completion Engine + Shell Integration

**Goal:** tab completion works in the shell.

- [ ] `resolveCompletions()`: static and dynamic sources, `dependsOn` context
- [ ] Completer caching: in-memory (per invocation) + filesystem (`~/.cache/<cli>/completions/`)
- [ ] Completion timeout: wrap dynamic completers, return empty on timeout
- [ ] Shell completion mode: `--complete --` flag detection, token stream → slot resolution
- [ ] Shell scripts: bash, zsh, fish output formats
- [ ] Built-in `completions install` command (writes shell script to appropriate location)

**Checkpoint:** install completions for bash or zsh. Tab-complete a command name, a flag, and a dynamic value (e.g. an environment name fetched from an API). Confirm it doesn't hang on a slow completer.

---

## Phase 5 — Interactive Prompt

**Goal:** commands can prompt interactively for missing required args.

- [ ] TTY input loop: raw byte reader, escape sequence state machine
- [ ] `text` prompt type: free input with cursor movement
- [ ] `select` prompt type: pick-one list (≤8 static values)
- [ ] `autocomplete` prompt type: fuzzy filter + re-fetch, debounced with AbortSignal
- [ ] `multi-select` prompt type: checkbox list, space to toggle
- [ ] `confirm` prompt: `y/N`, throws on non-TTY
- [ ] `runtime.prompt.fromSchema()`: walk schema, find unresolved required slots, present correct prompt type
- [ ] ANSI rendering: dropdown below current line, erase on re-render, restore on exit

**Checkpoint:** run a command without providing a required flag. Confirm it prompts interactively with the right prompt type. Try autocomplete with a live API-backed completer. Try running non-interactively (pipe stdin) and confirm it errors clearly rather than hanging.

---

## Phase 7 subset — `cli.config.ts` + Binary Build (early slice)

**Goal:** a product CLI can be built and run as a standalone binary — validates the full end-to-end stack including completions and prompts before investing in full runtime surface.

- [ ] `defineConfig()` + `cli.config.ts` shape: name, displayName, version, dirs, env
- [ ] Identity baked into binary at compile time (`__CLI_NAME__`, `__CLI_VERSION__`, etc.)
- [ ] Build script: `bun build --compile`

**Checkpoint:** build a minimal product binary. Run it with completions and interactive prompts. Confirm the wiring from schema → completion → prompt → run all works together end to end.

---

## Phase 3 — Full Runtime Surface

**Goal:** commands can do real work — read files, call APIs, show structured output.

- [ ] `OutputInterface`: `table`, `list`, `json`, `success`, `warn` (TTY vs pipe behaviour)
- [ ] `OutputInterface`: `spinner` + `withSpinner`, `progressBar` + `withProgressBar`
- [ ] `FsInterface`: `read`, `readBytes`, `write`, `exists`, `list`, XDG path helpers
- [ ] `StdinInterface`: `isTTY`, `read()`, `lines()` — prompt hard-error on non-TTY
- [ ] `LogInterface`: `verbose`, `debug` — wired to `--verbose`/`--debug` global flags
- [ ] Signal handling: `runtime.signal` (AbortSignal), `runtime.onExit()`, terminal cleanup on SIGINT/SIGTERM
- [ ] `SecretsInterface`: `get`, `set`, `delete` — scoped to command, backed by `credentials.toml` (0600)
- [ ] Config loading: two-phase TOML (`config.toml` top-level + command section), `runtime.config` + `runtime.commandConfig`; also wires config-defined plugin dirs (from Phase 2)
- [ ] Env var isolation: only declared env vars exposed on `runtime.env`
- [ ] `MockRuntime`: fill out all remaining fields (output calls recorded, fs virtual, fetch stub, secrets, signal abort)

**Checkpoint:** write a command that reads a config file, calls a real API with a token from `credentials.toml`, streams results into a progress bar, and outputs a table. Run it piped (`| cat`) and confirm plain output. Hit Ctrl+C mid-run and confirm clean exit.

---

## Phase 6 — Built-in Commands

**Goal:** the framework ships a complete out-of-the-box experience.

- [ ] `init`: first-run flow — prompt for required env vars, write `credentials.toml`, install completions
- [ ] `update`: fetch latest release, download binary, atomic replace via temp file + rename
- [ ] Update check: non-blocking background check (at most once/day, cached in `~/.cache/<cli>/`)
- [ ] `doctor`: validate plugin tree — unknown commands, flag conflicts, missing descriptions, wrong credential file permissions, version mismatches

**Checkpoint:** run the CLI fresh (no config). Confirm `init` walks you through setup. Run `doctor` and confirm it catches a deliberately broken plugin (wrong `frameworkVersion`, missing description, shadowed flag).

---

## Phase 7 — `cli.config.ts` + Build Pipeline (full)

**Goal:** a product CLI can be fully branded and distributed as a standalone binary.

- [x] `defineConfig()` + `cli.config.ts` shape (early slice, above)
- [ ] `install.sh` generation (curl install)
- [ ] npm wrapper package generation (`postinstall.js` downloads platform binary)
- [ ] Homebrew formula + Scoop manifest generation
- [ ] Middleware chain: `authMiddleware`, `telemetryMiddleware`, `errorMiddleware` — `skipMiddleware` on manifest
- [ ] Typed context: `Runtime<TContext>`, `contextFactory` in `cli.config.ts`

**Checkpoint:** create a minimal product CLI (`myctl`) on top of the framework. Install via the generated `install.sh`. Run `myctl --help` and confirm branding.

---

## Phase 8 — Hardening + Backwards Compatibility

**Goal:** the framework is safe to depend on — plugins don't break silently across versions.

- [ ] Versioned types: `CommandManifestV1`, `RuntimeV1` (establishes the pattern)
- [ ] Backwards compatibility integration tests: `CommandManifestV1` plugins run correctly against the current runtime
- [ ] `cape/testing` export: `MockRuntime` + `runCommand()` helper as a documented, stable testing API
- [ ] Schema validation: evaluate hand-rolled vs zod/arktype — add dependency if edge cases are unmanageable
- [ ] Performance: measure startup time with 10, 50, 100 plugins — confirm lazy loading holds up
- [ ] Error message polish pass: review all validation and runtime errors for clarity

**Checkpoint:** write a plugin using only the public testing API. Simulate a major version bump and confirm the backwards compat tests catch a breaking change before it ships.

---

## Notes

- Completion engine (Phase 4) and interactive prompt (Phase 5) share the same schema-as-truth foundation — do them together before full runtime.
- The early Phase 7 slice (defineConfig + binary build) validates end-to-end wiring before investing in the full runtime surface.
- Phase 3 (full runtime) comes after prompts and completions so those interactions can be validated in a real binary.
- Phase 6 (built-ins) depends on Phase 3 — particularly `SecretsInterface` for `init` and `FsInterface` for `update`.
- Phase 8 should be started before the framework is used in production, not after.
