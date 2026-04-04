# Implementation Plan

Ordered for fastest path to a runnable system. Each phase ends with a playable checkpoint so design problems surface early.

Progress: `[ ]` not started · `[x]` done · `[-]` in progress · `[~]` done but has loose ends

**Execution order (original):** Phase 1 → Phase 2 → Phase 4 (Completions) → Phase 5 (Interactive Prompt) → Phase 7 subset (defineConfig + binary) → Phase 3 (Full Runtime) → Phase 6 (Built-ins) → Phase 7 rest → Phase 8

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
- [x] Help text renderer: leaf-command usage (positionals shown instead of `<subcommand>`)
- [x] Wire one hardcoded command end-to-end: manifest → arg parse → run

**Checkpoint:**
```sh
bun example/main.ts hello --name World        # prints greeting
bun example/main.ts hello --help              # shows flags
bun example/main.ts hello --unknown-flag      # exit 2 with did-you-mean
bun example/main.ts --help                    # root help lists commands
```

---

## Phase 2 — Plugin Loader + Subcommand Routing ✓

**Goal:** commands are discovered automatically from the filesystem — no hardcoding.

- [x] `*.plugin.toml` minimal manifest format (`name`, `description`, `command`, `enabled`, `frameworkVersion`)
- [x] Plugin discovery: recursive scan of configured directories
- [x] Plugin directories: project-local (`./commands/`), user (`~/.config/<cli>/plugins/`)
- [x] Plugin directories: config-defined paths via `pluginDirs` in cli.config.ts
- [x] Subcommand routing: two-level dispatch (`cli → command → subcommand`), arg scope rules
- [x] Subcommand routing: positional arguments not mistaken for subcommand names
- [x] Execution mode: `executionMode` export (`"run" | "complete"`) set before dynamic import
- [x] Plugin compatibility check: semver major mismatch → hard error at load time
- [ ] Versioned types: `CommandManifestV1`, `RuntimeV1` (deferred to Phase 8)

**Checkpoint:**
```sh
# Drop a plugin into commands/ and confirm it appears:
bun example/main.ts --help                    # plugin command visible
bun example/main.ts <plugin-command> --help   # plugin flags shown
bun example/main.ts <plugin-command> --name X # plugin runs
```

---

## Phase 4 — Completion Engine + Shell Integration ✓

**Goal:** tab completion works in the shell.

- [x] `resolveCompletions()`: static and dynamic sources, `dependsOn` context
- [x] Completion timeout: wrap dynamic completers, return empty on timeout
- [x] Shell completion mode: `__complete` flag detection, token stream → slot resolution
- [x] Shell scripts: bash, zsh, fish output formats
- [x] Built-in `completions install` command (writes shell script to appropriate location)
- [ ] Completer caching: in-memory (per invocation) + filesystem (`~/.cache/<cli>/completions/`)

**Checkpoint:**
```sh
bun example/main.ts completions install       # installs for detected shell
# open new shell, then:
example-cli hello --<TAB>                     # completes --name, --shout, --repeat
example-cli fare<TAB>                         # completes to farewell
example-cli farewell <TAB>                    # completes wave, bow
```

---

## Phase 5 — Interactive Prompt ✓

**Goal:** commands can prompt interactively for missing required args.

- [x] TTY input loop: raw byte reader, escape sequence state machine
- [x] `text` prompt type: free input with cursor movement, placeholder default
- [x] `select` prompt type: pick-one list with arrow keys
- [x] `autocomplete` prompt type: fuzzy filter + re-fetch, debounced with AbortSignal
- [x] `autocomplete` prompt type: spinner animation while loading, stable cursor position
- [x] `multi-select` prompt type: checkbox list, space to toggle
- [x] `confirm` prompt: `y/N`, throws `NonTtyError` on non-TTY
- [x] `fromSchema()`: walk schema, find unresolved required slots, present correct prompt type
- [x] ANSI rendering: list below input line, erase on re-render, restore on exit
- [x] Auto-prompt wired into dispatch: missing required flags prompt on TTY, error on non-TTY
- [x] Ctrl+C / Escape during prompt → `PromptCancelledError` → dispatch catches → exit 130

**Checkpoint:**
```sh
bun example/main.ts hello                     # prompts for --name, enter value
bun example/main.ts hello                     # press Ctrl+C → exits cleanly (code 130)
bun example/main.ts demo select               # arrow-key select
bun example/main.ts demo autocomplete         # type to filter list
bun example/main.ts demo autocomplete-dynamic # spinner while fetching
echo "" | bun example/main.ts hello           # non-TTY → error, no prompt
```

---

## Phase 7 subset — `cli.config.ts` + Binary Build ✓

**Goal:** a product CLI can be built and run as a standalone binary.

- [x] `defineConfig()` + `cli.config.ts` shape: name, displayName, version, entry, outfile
- [x] `--version` global flag wired to config version
- [x] Build script: `bun build --compile` via `scripts/build.ts`

**Checkpoint:**
```sh
bun scripts/build.ts example/cli.config.ts
./example/greet --version
./example/greet --help
./example/greet hello --name World
./example/greet demo autocomplete            # prompts work in binary
```

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
- [x] `MockRuntime`: all fields implemented, call recording, virtual fs, signal abort, exit capture

**Loose end — `--config` flag declared but ignored:**
The global `--config <path>` flag is parsed and appears in help, but `BasicRuntime.loadConfig()` always reads from `~/.config/<cli>/config.toml` and never uses the override path. Fix: pass `globals.config` to `loadConfig()` in dispatch.

**Checkpoint:**
```sh
# Create a test command that uses runtime.output.table(), runtime.secrets, runtime.signal
bun example/main.ts <cmd> --verbose          # verbose log lines appear
bun example/main.ts <cmd> | cat              # piped: plain text, no spinner/colors
bun example/main.ts <cmd>                    # press Ctrl+C → onExit handlers run, clean exit
```

---

## Cape CLI (Phase 7 expanded) ✓

**Goal:** `cape` is a standalone tool for creating, running, building, and managing Cape-based CLIs.

- [x] `cape init --name <name>`: scaffold project (cli.config.ts, main.ts, commands/, tsconfig.json, .gitignore)
- [x] `cape init`: writes `node_modules/cape/` with embedded runtime + type declarations
- [x] `cape init`: generated tsconfig has `allowImportingTsExtensions` + `noEmit`
- [x] `cape run --name <cli> [-- <args>]`: run CLI via embedded Bun runtime (no bun in PATH needed)
- [x] `cape run`: refreshes `node_modules/cape/` from embedded bundle before running
- [x] `cape build [--all-platforms]`: compile to binary, generate `install.sh` if `install` config set
- [x] `cape build`: `install.sh` installs to `~/.<name>/bin/`
- [x] `cape build`: `InstallConfig` supports `{ type: "github", repo }` and `{ type: "custom", url }`
- [x] `cape command add --name <n> --description <d>`: generate typed command file with TODO scaffold
- [x] `cape link --name <cli>`: create shell shim at `~/.<name>/bin/<name>` pointing to `cape run`
- [x] `cape install --name <cli> [--binary <path>]`: copy compiled binary to `~/.<name>/bin/<name>`
- [x] `cape:prebuild` / `cape:build` / `cape:install` npm scripts
- [x] Cape CLI is itself a Cape-based CLI (dogfooding)

**Checkpoint:**
```sh
# Full developer workflow:
cape init --name myctl --yes
cd myctl
cape link --name myctl                       # ~/. myctl/bin/myctl → cape run shim
export PATH="$HOME/.myctl/bin:$PATH"
myctl --help                                 # runs via cape run
myctl hello --name World                     # real command works

cape command add --name deploy --description "Deploy to env"
# add deploy to main.ts, then:
myctl deploy                                 # new command works

cape build                                   # compiles dist/myctl
cape install --name myctl                    # replaces shim with real binary
myctl hello --name World                     # now runs compiled binary (no cape needed)

# Verify binary is standalone:
PATH=/usr/bin:/bin myctl hello --name World  # works without cape or bun in PATH
```

---

## Phase 0 — Loose Ends Cleanup (next up)

**Goal:** fix known gaps in completed phases before moving forward.

- [x] **`--config` flag**: pass `globals.config` override path to `loadConfig()` in dispatch
- [ ] **Completer caching**: filesystem cache (`~/.cache/<cli>/completions/`) — skip in-memory cache (no benefit: each completion is a separate process invocation)
- [x] **`cape run` / `cape build`**: refactor config loading to use shared `resolveName()` helper from `helpers.ts`
- [x] **`--json` global flag**: `createJsonOutput` buffers all output; `flushOutput()` emits single JSON object after successful `command.run()`; 4-case shape (see `output.ts`)

**Checkpoint:**
```sh
# --config override:
example-cli hello --config ./my-config.toml --name World   # loads from custom path

# Tab completion caching (time it):
time example-cli hello --name <TAB>          # first call: fetches
time example-cli hello --name <TAB>          # second call: cache hit, faster
```

---

## Phase 6 — Built-in Commands (partially done)

**Goal:** the framework ships a complete out-of-the-box experience.

- [x] `init`: first-run flow — prompt for credentials, write `credentials.toml`, install completions
- [ ] `update`: fetch latest release from GitHub/custom URL, download binary, atomic replace (temp file + rename), verify checksum
- [ ] Update check: non-blocking background check (at most once/day, result cached in `~/.cache/<cli>/update-check.json`)
- [ ] `doctor`: validate plugin tree — missing descriptions, unknown commands, flag conflicts, wrong credential file permissions (should be 0600), version mismatches

**Checkpoint:**
```sh
# update (needs a real GitHub release to test against):
myctl update                                 # downloads new binary, replaces itself
myctl --version                             # new version

# update check (background):
myctl --help                                # note: update available banner if outdated

# doctor:
chmod 644 ~/.config/myctl/credentials.toml  # break permissions deliberately
myctl doctor                                # reports wrong permissions
chmod 600 ~/.config/myctl/credentials.toml  # fix it
myctl doctor                                # clean bill of health
```

---

## Phase 8 — Hardening + Backwards Compatibility

**Goal:** the framework is safe to depend on — plugins don't break silently across versions.

- [ ] Versioned types: `CommandManifestV1`, `RuntimeV1` — establishes the stable contract
- [ ] Backwards compatibility integration tests: a `V1` plugin runs correctly against current runtime
- [ ] `cape/testing` stable export: `MockRuntime` + `runCommand()` as a documented public testing API
- [ ] Schema validation: evaluate hand-rolled vs zod/arktype — add dependency if edge cases become unmanageable
- [ ] Performance: measure cold startup with 10 / 50 / 100 plugins — confirm lazy loading holds
- [ ] Error message polish: review all validation and runtime error strings for clarity and consistency

**Checkpoint:**
```sh
# Public testing API:
# In a user project:
import { MockRuntime, runCommand } from "cape/testing";
const rt = new MockRuntime({ args: ["--name", "World"] });
await runCommand(helloCommand, rt);
expect(rt.outputCalls[0]).toMatchObject({ type: "print", text: "Hello, World!" });

# Backwards compat:
# Build a plugin with CommandManifestV1, run it with the latest cape → should work
# Bump the major version in the framework → the compat test should now fail with a clear error
```

---

## Phase 9 — Distribution (future)

**Goal:** cape-based CLIs can be distributed through standard package managers.

- [ ] npm wrapper: `postinstall.js` downloads the platform binary from GitHub/custom URL
- [ ] Homebrew formula generation (`brew install myorg/myctl/myctl`)
- [ ] Scoop manifest generation (Windows)
- [ ] `cape publish` command: create GitHub release + upload platform binaries

**Checkpoint:**
```sh
# npm:
npm install -g myctl                         # postinstall downloads binary
myctl --help

# Homebrew:
brew install myorg/myctl/myctl
myctl --help
```

---

## Notes

- Completion engine (Phase 4) and interactive prompt (Phase 5) share the same schema-as-truth foundation — do them together before full runtime.
- The early Phase 7 slice (defineConfig + binary build) validates end-to-end wiring before investing in the full runtime surface.
- Phase 3 (full runtime) comes after prompts and completions so those interactions can be validated in a real binary.
- Phase 6 (built-ins) depends on Phase 3 — particularly `SecretsInterface` for `init` and `FsInterface` for `update`.
- Phase 0 (loose ends) should be done before Phase 6 and Phase 8 to avoid patching on top of known gaps.
- Phase 8 should be started before the framework is used in production, not after.
- Phase 9 items are genuinely optional for internal tooling — only needed for public distribution.
