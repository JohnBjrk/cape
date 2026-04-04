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

**Checkpoint:** write a `hello` command with a `--name` flag. Run it, get help with `--help`, see a validation error with `--unknown-flag`. Confirm the design feels right before building the loader. ✓

---

## Phase 2 — Plugin Loader + Subcommand Routing ✓

**Goal:** commands are discovered automatically from the filesystem — no hardcoding.

- [x] `*.plugin.toml` minimal manifest format (`name`, `description`, `command`, `enabled`, `frameworkVersion`)
- [x] Plugin discovery: recursive scan of configured directories
- [ ] Plugin directories: config-defined paths (deferred to Phase 3 — config loading)
- [x] Plugin directories: project-local (`./commands/`), user (`~/.config/<cli>/plugins/`)
- [x] Subcommand routing: two-level dispatch (`cli → command → subcommand`), arg scope rules
- [x] Execution mode: `executionMode` export (`"run" | "complete"`) set before dynamic import
- [x] Plugin compatibility check: semver major mismatch → hard error at load time
- [ ] Versioned types: `CommandManifestV1`, `RuntimeV1` (deferred to Phase 8 — hardening)

**Checkpoint:** drop a `*.plugin.toml` + TS file into `./commands/`, run the CLI, have the command appear and work. ✓

---

## Phase 4 — Completion Engine + Shell Integration ✓

**Goal:** tab completion works in the shell.

- [x] `resolveCompletions()`: static and dynamic sources, `dependsOn` context
- [ ] Completer caching: in-memory (per invocation) + filesystem (`~/.cache/<cli>/completions/`)
- [x] Completion timeout: wrap dynamic completers, return empty on timeout
- [x] Shell completion mode: `__complete` flag detection, token stream → slot resolution
- [x] Shell scripts: bash, zsh, fish output formats
- [x] Built-in `completions install` command (writes shell script to appropriate location)

**Checkpoint:** install completions, tab-complete command names, flags, and dynamic values. ✓

---

## Phase 5 — Interactive Prompt ✓

**Goal:** commands can prompt interactively for missing required args.

- [x] TTY input loop: raw byte reader, escape sequence state machine
- [x] `text` prompt type: free input with cursor movement, placeholder default
- [x] `select` prompt type: pick-one list with arrow keys
- [x] `autocomplete` prompt type: fuzzy filter + re-fetch, debounced with AbortSignal
- [x] `multi-select` prompt type: checkbox list, space to toggle
- [x] `confirm` prompt: `y/N`, throws on non-TTY
- [x] `fromSchema()`: walk schema, find unresolved required slots, present correct prompt type
- [x] ANSI rendering: list below input line, erase on re-render, restore on exit
- [x] Auto-prompt wired into dispatch: missing required flags prompt on TTY, error on non-TTY

**Checkpoint:** run a command without providing a required flag — prompted interactively with the right type. Built and tested in the compiled binary. ✓

---

## Phase 7 subset — `cli.config.ts` + Binary Build ✓

**Goal:** a product CLI can be built and run as a standalone binary.

- [x] `defineConfig()` + `cli.config.ts` shape: name, displayName, version, entry, outfile
- [x] `--version` global flag wired to config version
- [x] Build script: `bun build --compile` via `scripts/build.ts`

**Checkpoint:** build a standalone binary, run with completions and interactive prompts. ✓

---

## Phase 3 — Full Runtime Surface ✓

**Goal:** commands can do real work — read files, call APIs, show structured output.

- [x] `OutputInterface`: `table`, `list`, `json`, `success`, `warn` (TTY vs pipe behaviour)
- [x] `OutputInterface`: `spinner` + `withSpinner`, `progressBar` + `withProgressBar`
- [x] `FsInterface`: `read`, `readBytes`, `write`, `exists`, `list`, XDG path helpers
- [x] `StdinInterface`: `isTTY`, `read()`, `lines()` — prompt hard-error on non-TTY
- [x] `LogInterface`: `verbose`, `debug` — wired to `--verbose`/`--debug` global flags
- [x] Signal handling: `runtime.signal` (AbortSignal), `runtime.onExit()`, terminal cleanup on SIGINT/SIGTERM
- [x] `SecretsInterface`: `get`, `set`, `delete` — scoped to command, backed by `credentials.toml` (0600)
- [x] Config loading: two-phase TOML (`config.toml` top-level + command section), `runtime.config` + `runtime.commandConfig`
- [x] Env var isolation: only declared env vars exposed on `runtime.env` (via `schema.env?: string[]`)
- [x] `MockRuntime`: fill out all remaining fields (output calls recorded, fs virtual, secrets, signal abort)

**Checkpoint:** write a command that reads a config file, calls a real API with a token from `credentials.toml`, streams results into a progress bar, and outputs a table. Run it piped (`| cat`) and confirm plain output. Hit Ctrl+C mid-run and confirm clean exit.

---

## Phase 6 — Built-in Commands

**Goal:** the framework ships a complete out-of-the-box experience.

- [x] `init`: first-run flow — prompt for required env vars, write `credentials.toml`, install completions
- [ ] `update`: fetch latest release, download binary, atomic replace via temp file + rename
- [ ] Update check: non-blocking background check (at most once/day, cached in `~/.cache/<cli>/`)
- [ ] `doctor`: validate plugin tree — unknown commands, flag conflicts, missing descriptions, wrong credential file permissions, version mismatches

**Checkpoint:** run the CLI fresh (no config). Confirm `init` walks you through setup. Run `doctor` and confirm it catches a deliberately broken plugin.

---

## Phase 7 — `cli.config.ts` + Build Pipeline (full) ✓

**Goal:** a product CLI can be fully branded and distributed as a standalone binary.

- [x] `defineConfig()` + `cli.config.ts` shape (early slice, above)
- [x] `install.sh` generation (curl install)
- [x] `cape` meta-CLI: `cape init`, `cape run`, `cape build`, `cape command add`
- [x] Embedded runtime: cape bundles its own source; `cape init`/`cape run` write it to `node_modules/cape/`
- [ ] npm wrapper package generation (`postinstall.js` downloads platform binary)
- [ ] Homebrew formula + Scoop manifest generation
- [ ] Middleware chain: `authMiddleware`, `telemetryMiddleware`, `errorMiddleware` — `skipMiddleware` on manifest
- [ ] Typed context: `Runtime<TContext>`, `contextFactory` in `cli.config.ts`

**Checkpoint:** `cape init myapp` → `cape run -- hello --name World` → `cape build` → standalone binary that runs without bun. ✓

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
