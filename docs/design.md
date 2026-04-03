# CLI Framework Design

A framework for building extensible, distributable CLIs with Bun. Commands are loaded as plugins, interact with the world through a controlled runtime, and share a unified completion system that powers both shell tab completion and interactive prompts.

-----

## Principles

- **Zero/minimal dependencies** — arg parser, prompt, and completion engine are all hand-rolled. Known exceptions: keychain integration (if added) will require a native binding. Schema validation is another candidate — hand-rolling validation is viable but has many edge cases; if it becomes unwieldy, a library like [zod](https://zod.dev) or [arktype](https://arktype.io) is an acceptable dependency to add.
- **Commands are isolated** — they only interact with the outside world through the `Runtime` interface
- **Schema is the source of truth** — help text, shell completions, and interactive prompts all derive from the same manifest
- **Lazy by default** — plugin manifests are cheap to load; full modules and dynamic completers are only invoked when needed

-----

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                      CLI Entry                       │
│              (single bun binary / script)            │
└──────────────────────────┬──────────────────────────┘
                           │
              ┌────────────▼────────────┐
              │        Runtime          │
              │  - arg parsing          │
              │  - prompt/UI            │
              │  - shell completions    │
              │  - plugin loader        │
              └────────────┬────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   ┌────▼────┐        ┌────▼────┐        ┌────▼────┐
   │ Command │        │ Command │        │ Command │
   │ Plugin  │        │ Plugin  │        │ Plugin  │
   └─────────┘        └─────────┘        └─────────┘
```

-----

## Arg Parser

Declaration-first: commands declare their args upfront via a schema, and the parser validates against it. This is what enables completions and interactive prompts.

```ts
interface ArgSchema {
  positionals?: {
    name: string;
    variadic?: boolean;
    complete?: CompletionSource;
  }[];
  flags?: {
    [name: string]: {
      type: "boolean" | "string" | "number";
      alias?: string;
      required?: boolean;
      multiple?: boolean;              // flag may be repeated; parsed as string[]
      default?: unknown;
      complete?: CompletionSource;
      hideInSubcommandHelp?: boolean;  // default false — opt out to suppress from "Inherited" section
    };
  };
}
```

**Parsing strategy:** one pass over `process.argv.slice(2)`, building a token stream first (`{ type: 'flag' | 'value' | 'separator', raw }`), then resolving against the schema.

Support from day one:

- `--` separator convention
- Flag clustering: `-abc` → `-a -b -c`
- Both `--flag=value` and `--flag value` forms

Tokens appearing after `--` are not validated — they are collected as-is into `args.passthrough: string[]` and forwarded by the command to whatever subprocess it wraps. This is the only sanctioned way to pass unknown flags through the CLI.

### Validation Errors

Validation runs after the token stream is resolved against the schema. All errors print to stderr and exit with code `2` (usage error), distinct from code `1` (runtime error from command implementation).

**Error cases and messages:**

| Situation | Message |
|---|---|
| Unknown flag | `Error: unknown flag --foo` |
| Wrong type | `Error: --count expects a number, got "abc"` |
| Missing required flag | `Error: missing required flag --environment` |
| Missing required positional | `Error: missing required argument <service>` |
| Unknown command | `Error: unknown command "deplooy" — did you mean "deploy"?` |
| Unknown subcommand | `Error: unknown subcommand "cert" — did you mean "certificate"?` |

Every error appends a pointer to help:
```
Run 'mycli generate --help' to see available flags.
```

**Did-you-mean** suggestions (shown for unknown commands and subcommands) use simple edit-distance matching against the known name list — no dependencies required for this.

Full help text is not reprinted on error. The pointer to `--help` is enough; reprinting help conflates two different user intents (asking for help vs making a typo).

-----

## Subcommand Routing

The framework supports a maximum of two levels: `cli → command → subcommand`. Deeper nesting is not supported.

**Dispatch is left-to-right:** the parser consumes tokens in order — CLI name (implicit), then command, then optional subcommand. Each level is resolved against the manifests loaded at startup.

### Arg Scoping

Three scopes, each with a visibility rule:

| Scope | Where valid in token stream |
|---|---|
| Global flags (e.g. `--json`, `--verbose`) | Anywhere |
| Command flags | After the command token, including after the subcommand token |
| Subcommand flags | Only after the subcommand token |

This means `mycli --json generate --output dist certificate --format pem` is valid: `--json` is global, `--output` is a command flag appearing before the subcommand, `--format` is a subcommand flag.

**Flag name collisions:** if a command flag and one of its subcommand flags share the same name, the subcommand flag wins for tokens appearing after the subcommand token.

### Unknown Commands and Subcommands

The parser does not abort on unknown command or subcommand tokens — it continues classifying remaining tokens by scope (globals still parse, command flags still parse after an unknown subcommand). Execution fails at runtime with an "unknown command" or "unknown subcommand" error. This allows the parser to still surface useful arg errors even when the command path is wrong.

### Conflict Detection

Flag shadowing and duplicate command names are not enforced at parse time. Instead, the framework provides a built-in `doctor` command that validates the full loaded plugin tree:

- Duplicate command or subcommand names
- Flag name collisions between a command and its subcommands (warns, does not error)
- Missing required manifest fields
- Unresolvable dynamic subcommand resolvers

`doctor` supports `--json` output and exits non-zero if hard errors are found, making it suitable for use in CI. Commands can also conflict via aliases — `doctor` checks those too.

-----

## Help Text

Help is triggered exclusively by `--help` or `-h`, valid anywhere in the token stream. The flag is resolved before command dispatch — no module is imported to render help. The deepest successfully resolved level determines what is shown:

- `mycli --help` → top-level (commands + global flags)
- `mycli generate --help` → command level (subcommands + command flags + global flags)
- `mycli generate certificate --help` → subcommand level (subcommand flags + inherited command flags + global flags)

If `--help` appears after an unknown command or subcommand token, the parser shows help for the deepest *known* level with an "unknown command" notice above it.

### Output Structure

**Top level (`mycli --help`)**
```
[helpHeader — if theme.helpHeader.showOn is "top-level" or "always"]

MyCompany CLI v1.0.0 — Manage your MyCompany resources

Usage: myctl <command> [subcommand] [flags]

Commands:
  generate    Generate certificates, keys, and configs
  deploy      Deploy services to an environment

Global Flags:
  --json          Output as JSON
  --verbose, -v   Enable verbose logging
  --help, -h      Show help

Run 'myctl <command> --help' for command-specific help.
```

**Command level (`mycli generate --help`)**
```
[helpHeader — if theme.helpHeader.showOn is "always"]

generate — Generate certificates, keys, and configs

Usage: myctl generate <subcommand> [flags]

Subcommands:
  certificate   Generate a TLS certificate
  key           Generate an RSA or EC key

Command Flags:
  --output, -o <path>   Output directory (default: ./dist)
  --format <fmt>        Output format: pem, der (default: pem)

Global Flags:
  --json          Output as JSON
  --help, -h      Show help

Run 'myctl generate <subcommand> --help' for subcommand-specific help.
```

**Subcommand level (`mycli generate certificate --help`)**
```
[helpHeader — if theme.helpHeader.showOn is "always"]

generate certificate — Generate a TLS certificate

Usage: myctl generate certificate [flags]

Flags:
  --ca <path>     Path to CA certificate
  --days <n>      Validity period in days (default: 365)

Inherited from 'generate':
  --output, -o <path>   Output directory (default: ./dist)
  (flags with hideInSubcommandHelp: true are omitted from this section)

Global Flags:
  --json          Output as JSON
  --help, -h      Show help
```

### Theme Integration

`cli.config.ts` controls whether the `helpHeader` block (e.g. ASCII art) appears in help output:

```ts
theme: {
  accentColor: "#0066ff",
  helpHeader: {
    content: `...ascii art...`,
    showOn: "top-level",  // "top-level" | "always"
  },
}
```

`"top-level"` is the recommended default — showing the full header on every `--help` invocation gets noisy at depth.

### Help and the Schema Contract

Help text is generated entirely from the manifest — no module is imported. This means:

- Every flag needs a `description` in its schema to appear usefully in help
- Commands without a `description` in their manifest get a placeholder warning in help output (also caught by `doctor`)

-----

## Plugin / Command Loading

Loading is split into two phases to keep startup cheap regardless of how many plugins are installed.

### Phase 1: Minimal Manifest (Discovery)

Each top-level command has a small, plain-data TOML file that the loader can read without importing any JS. This is the only thing loaded at startup:

```toml
# generate.plugin.toml
name = "generate"
description = "Generate certificates, keys, and configs"
command = "./generate.ts"
enabled = true
frameworkVersion = "1.0.0"
```

The loader discovers commands by recursively scanning configured directories for `*.plugin.toml` files. No prescribed folder structure is required — the minimal manifest is self-contained.

Subcommands are **not** represented at this layer. They are declared inside the full TS module (phase 2) and only become relevant once the parent command is already being dispatched.

### Phase 2: Full Module (On Demand)

The TS file referenced by `command` in the minimal manifest exports both the full manifest (flags, args, subcommands, completers) and the implementation. It is dynamically imported only when the command is actually dispatched — or when completions or help are requested for it.

The exact split between what goes into the exported `manifest` object and the exported `command` object will be ironed out during implementation, once real command examples make the right boundary clear.

### Execution Mode

The framework sets an execution mode before dynamically importing a command module. Command files can read this at module level to avoid loading heavy dependencies during completion:

```ts
import { executionMode } from "cape";
// "run" | "complete"

const client = executionMode === "run"
  ? await import("./heavy-sdk.ts")
  : null;

export const manifest = { ... };
export const command = {
  completers: { environments: async () => fetchEnvironments() },
  run: async (args, runtime) => { await client!.deploy(...) },
};
```

This is the recommended pattern — not enforced, but the `executionMode` export makes it easy to follow without any framework ceremony.

### Plugin Discovery Sources

The loader merges plugins from these locations, in priority order (first match wins for name conflicts):

1. `./commands/` relative to the binary — project-local commands
2. `~/.config/<cli>/plugins/` — user-level plugins
3. Paths declared in the global config file (`~/.config/<cli>/config.toml`)
4. Paths declared in a repo-local config file (e.g. `.myclirc` in the project root)

This means a user can drop a plugin into their home config and have it available everywhere, or check a plugin into a repo and have it available only in that project — without rebuilding the binary.

**Note on compiled binaries:** Bun’s `--compile` flag produces a self-contained binary that retains full filesystem access at runtime. Dynamic `import()` of external plugin files works in compiled binaries — verified with Bun 1.3.9.

### Plugin Compatibility Versioning

The `frameworkVersion` field in `*.plugin.toml` lets the loader fast-fail on incompatible plugins before importing any module. But version safety is enforced at two layers:

**Layer 1 — Runtime check (loader)**

At discovery time, the loader reads `frameworkVersion` from the TOML and applies semver compatibility rules:

- Same major version → compatible, load normally
- Different minor/patch → warn in `doctor`, load anyway
- Different major version → hard error, plugin not loaded:

```
Error: plugin "generate" requires framework v2.x but this binary uses v1.3.0.
       Rebuild the plugin against the current framework version.
```

**Layer 2 — Compile-time check (TypeScript)**

The framework exports versioned manifest and runtime types. A plugin author declares which version they’re targeting once, and TypeScript enforces it everywhere:

```ts
// Framework exports versioned types — only on breaking changes
interface CommandManifestV1 {
  frameworkVersion: `1.${string}`;  // template literal — only accepts "1.x.x"
  // ...
}

// Command type infers the correct Runtime version from the manifest type
interface Command<M extends CommandManifestV1 | CommandManifestV2> {
  manifest: M;
  run(
    args: ParsedArgs,
    runtime: M extends CommandManifestV2 ? RuntimeV2 : RuntimeV1
  ): Promise<void>;
}

// Plugin author — one declaration locks in the version for both manifest and runtime
export const manifest: CommandManifestV1 = {
  name: "generate",
  frameworkVersion: "1.0.0",  // TypeScript enforces this matches "1.x"
  // ...
};

export const command: Command<typeof manifest> = {
  manifest,
  run: async (args, runtime) => {
    // runtime is typed as RuntimeV1
    // accessing v2-only features is a compile error
  },
};
```

`Command<typeof manifest>` infers the runtime version from the manifest type — no separate version declaration needed. Plugins can migrate to a new major version one at a time; a v1 plugin compiles correctly in a v2 framework package because it explicitly opts into `CommandManifestV1` types.

**Backwards compatibility requirement**

The framework runtime must remain backwards compatible for all supported `CommandManifest` versions — a v1 plugin must work correctly in a v2 or v3 binary. This must be covered by explicit integration tests that instantiate each supported manifest version against the current runtime and verify correct behaviour. These tests are the contract: if they pass, old plugins work.

**Dropping support for old versions**

When a manifest version is no longer supported (e.g. `CommandManifestV1` is retired), the loader produces a hard runtime error at load time — the same path as a major version mismatch:

```
Error: plugin "generate" uses CommandManifestV1 which is no longer supported.
       Minimum supported version is v2. Rebuild the plugin against the current framework.
```

The backwards compatibility integration tests for the dropped version are removed at the same time, making the removal explicit and deliberate.

-----

## Global Flags

These flags are available on every command and subcommand without any declaration in the command's schema. The framework handles them before dispatching to the command — commands get their effects for free.

| Flag | Short | Description |
|---|---|---|
| `--help` | `-h` | Show help for the current command level |
| `--json` | | Output as machine-readable JSON |
| `--verbose` | `-v` | Enable verbose log output |
| `--debug` | | Enable debug log output (superset of `--verbose`) |
| `--quiet` | `-q` | Suppress all output except errors |
| `--no-color` | | Disable ANSI color and formatting |
| `--config <path>` | | Override config file location |

### Behaviour Matrix

Some flags interact. When multiple are active, the most restrictive wins:

| | `--json` | `--quiet` | `--no-color` | non-TTY stdout |
|---|---|---|---|---|
| `print()` | unchanged | suppressed | plain | plain |
| `printError()` | unchanged | **not suppressed** | plain | plain |
| `output.table()` | JSON | suppressed | — | plain |
| `output.list()` | JSON | suppressed | — | plain |
| `output.success()` | suppressed | suppressed | plain | plain |
| `output.warn()` | suppressed | suppressed | plain | plain |
| Spinners / progress | suppressed | suppressed | plain | suppressed |
| `log.verbose()` | suppressed | suppressed | plain | plain |
| `log.debug()` | suppressed | suppressed | plain | plain |

### `--no-color` and `NO_COLOR`

`--no-color` also activates when the `NO_COLOR` environment variable is set (any non-empty value), following the convention at [no-color.org](https://no-color.org). CI systems that set `NO_COLOR=1` automatically get plain output without needing the explicit flag.

### `--config <path>`

Overrides the standard config file discovery order — the specified file is used instead of the repo-local and user config files. The credentials file location is not affected. Useful in CI pipelines and test environments where a specific config should be used regardless of the working directory.

### `--quiet` and exit codes

`--quiet` suppresses output but does not suppress exit codes. A command that fails still exits with a non-zero code — callers relying on `--quiet` in scripts can still detect failure.

-----

## Runtime Interface

Commands receive a `Runtime` object rather than raw access to `process`, `fs`, or `fetch`. This is the central design decision: it creates a single seam for testing, keeps commands portable, and makes the capability surface explicit.

```ts
interface Runtime {
  // Output
  print(text: string): void;
  printError(text: string): void;
  output: OutputInterface;         // structured output (tables, json mode, etc.)

  // Input
  args: ParsedArgs;
  env: Record<string, string>;     // explicitly passed env vars, not raw process.env
  config: Record<string, unknown>;        // top-level config, typed via cli.config.ts schema
  commandConfig: Record<string, unknown>; // this command's config section only
  prompt: PromptInterface;

  // Filesystem
  fs: FsInterface;

  // Network
  fetch(url: string, options?: RequestInit): Promise<Response>;

  // stdin
  stdin: StdinInterface;

  // Logging
  log: LogInterface;

  // Process
  exit(code: number): never;
  exec(cmd: string, args: string[]): Promise<ExecResult>;

  // Secrets
  secrets: SecretsInterface;         // scoped to this command — cannot read other commands' secrets

  // Signals
  signal: AbortSignal;               // aborted on SIGINT or SIGTERM
  onExit(fn: () => void): void;      // register cleanup to run before process exits
}
```

### Output

`print` / `printError` cover the simple cases. `output` handles structured data so the runtime can adapt rendering based on context — human-readable when attached to a TTY, machine-readable when piped:

```ts
interface OutputInterface {
  table(rows: Record<string, unknown>[]): void;
  list(items: string[]): void;
  json(value: unknown): void;        // always raw JSON regardless of TTY
  success(message: string): void;    // prefixed/colored in TTY, plain in pipe
  warn(message: string): void;

  // Progress — both suppressed in non-TTY and --json mode
  spinner(label: string): SpinnerHandle;
  withSpinner<T>(label: string, fn: () => Promise<T>): Promise<T>;
  progressBar(options: { total: number; label?: string }): ProgressBarHandle;
  withProgressBar<T>(options: { total: number; label?: string }, fn: (bar: ProgressBarHandle) => Promise<T>): Promise<T>;
}

interface SpinnerHandle {
  update(label: string): void;
  succeed(label?: string): void;    // stops spinner, prints ✓ label
  fail(label?: string): void;       // stops spinner, prints ✗ label
}

interface ProgressBarHandle {
  update(value: number): void;      // set absolute value
  increment(by?: number): void;     // increment by 1 or by
  succeed(label?: string): void;
  fail(label?: string): void;
}
```

Both spinner and progress bar are rendered using ANSI escape codes — no dependencies. The wrapper variants (`withSpinner`, `withProgressBar`) guarantee cleanup if the wrapped function throws, making them the preferred pattern for simple cases. The explicit handle variants are available when the label needs to be updated mid-operation or progress is reported incrementally from a loop:

```ts
// Simple case — wrapper
await runtime.output.withSpinner("Connecting to API...", () => connect());

// Updating label mid-operation — explicit handle
const spinner = runtime.output.spinner("Fetching config...");
const config = await fetchConfig();
spinner.update("Deploying...");
await deploy(config);
spinner.succeed("Deployed successfully.");

// Progress bar — known count
const bar = runtime.output.progressBar({ total: files.length, label: "Uploading" });
for (const file of files) {
  await upload(file);
  bar.increment();
}
bar.succeed("All files uploaded.");
```

The full set of global flags and their interactions is covered in the Global Flags section. The key output-affecting flags: `--json` flips `table()` and `list()` to emit structured JSON; `--quiet` suppresses everything except `printError()`; `--no-color` strips ANSI codes; spinners and progress bars are suppressed in `--json` mode, `--quiet` mode, and when stdout is not a TTY.

### Filesystem

```ts
interface FsInterface {
  read(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  write(path: string, data: string | Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<string[]>;
  // Convenience: XDG-aware paths scoped to the CLI's name
  configPath(file: string): string;   // ~/.config/<cli>/file
  cachePath(file: string): string;    // ~/.cache/<cli>/file
  dataPath(file: string): string;     // ~/.local/share/<cli>/file
}
```

The XDG helpers are small but meaningful — commands shouldn’t hardcode `~/.config/mycli` themselves, and having it on the runtime means the CLI name is injected once at the top level.

### Environment

Rather than exposing `process.env` directly, the runtime provides only what the command declared it needs in its manifest:

```ts
// In the manifest
interface CommandManifest {
  // ...
  env?: {
    [key: string]: { description: string; required?: boolean; default?: string };
  };
}

// What the command sees
runtime.env["API_KEY"]   // present if declared, absent otherwise
```

This documents dependencies explicitly and prevents commands from silently reading arbitrary env vars — useful for auditing and for test setup (you only need to provide the vars the command declared).

### Credentials

Sensitive values (API tokens, passwords) are stored separately from the regular config file in `~/.config/myctl/credentials.toml`, written with `0600` permissions (owner read/write only). Keeping credentials in a dedicated file reduces the risk of accidental version control exposure — users are less likely to commit `credentials.toml` than a general config file, and `.gitignore` patterns are easier to apply to a predictably named file.

**Two credential tiers:**

- **Product-level** — declared in `cli.config.ts` (e.g. `MYCTL_TOKEN`), stored in the top-level section of `credentials.toml`, injected transparently into `runtime.env` at startup. Commands access these via `runtime.env` and are unaware of the storage source.
- **Plugin-scoped** — managed by individual commands via `runtime.secrets`. Automatically namespaced to the command — a plugin cannot read another plugin's secrets.

**File structure:**

```toml
# ~/.config/myctl/credentials.toml
# Sensitive — do not commit to version control.
# Permissions must be 0600.

# Product-level — injected into runtime.env
MYCTL_TOKEN = "tok_abc123"

# Plugin-scoped — accessed via runtime.secrets (namespaced by command name)
[generate]
token = "gen_xyz789"

[deploy]
api_key = "dep_abc123"
```

**`SecretsInterface`** — available as `runtime.secrets`, scoped to the current command:

```ts
interface SecretsInterface {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

// In a plugin's auth subcommand:
await runtime.secrets.set("token", "tok_abc123");  // writes to [deploy] section

// In the same plugin's run command:
const token = await runtime.secrets.get("token");  // reads from [deploy] section only
```

**Precedence order for product-level env var resolution:**

1. Actual environment variables (set in the shell)
2. `credentials.toml` top-level section
3. Config file values (for non-sensitive defaults)
4. Schema defaults declared in the manifest

**Write path** — product-level credentials are written by the built-in `init` command. Plugin credentials are written by the plugin itself via `runtime.secrets.set()`. The framework always enforces `0600` permissions on write.

**`doctor` checks:**
- `credentials.toml` exists but has permissions wider than `0600` — warn
- Required env var declared in manifest is missing from both shell env and credentials file — error

**In `MockRuntime`**, secrets are pre-populated and calls are recorded:

```ts
const runtime = new MockRuntime({
  secrets: { token: "test-token" },
});
```

**Future: keychain integration**

File-based storage with `0600` permissions is the v1 baseline. If OS keychain integration is added later (macOS Keychain, Linux Secret Service, Windows Credential Manager), it would require a native dependency — which is an acceptable exception to the zero-dependency principle for a security feature. The `SecretsInterface` abstraction means commands need no changes when the backend is swapped.

### Config File

Config files use TOML — parsed at runtime via `Bun.TOML.parse()` (no dependencies, verified working in compiled binaries). Comments are supported, which makes user-edited config files significantly more maintainable than JSON.

**File locations, merged in priority order:**

1. CLI flags (highest priority)
2. Env vars
3. Repo-local: `.myctl.toml` in the working directory (walked up to the project root)
4. User: `~/.config/myctl/config.toml`
5. Schema defaults (lowest priority)

**File structure:**

```toml
# ~/.config/myctl/config.toml

# Top-level keys — declared in cli.config.ts
defaultEnvironment = "staging"
apiUrl = "https://api.example.com"

# Command-specific sections — declared in each command's manifest
[generate]
outputDir = "./dist"
format = "pem"

[deploy]
timeout = 300
strategy = "rolling"
```

**Two-phase loading:**

- **Phase 1** — the framework loads top-level keys on startup, validated against the schema declared in `cli.config.ts`. Available as `runtime.config`.
- **Phase 2** — when a command is dispatched, the framework loads that command's TOML section, validated against the config schema in the command's manifest. Available as `runtime.commandConfig`. Other commands' sections are stripped and never exposed — a command cannot read another command's config.

Subcommands share their parent command's config section (`[generate]` covers both `generate` and `generate certificate`). If a subcommand needs finer-grained config, the command author can define their own key hierarchy within that section.

**Schema declaration in `cli.config.ts`** (top-level config):

```ts
export default defineConfig({
  config: {
    defaultEnvironment: { type: "string", default: "staging", description: "Default target environment" },
    apiUrl: { type: "string", description: "API base URL" },
  },
});
```

**Schema declaration in a command manifest** (command config):

```ts
export const manifest: CommandManifest = {
  name: "generate",
  config: {
    outputDir: { type: "string", default: "./dist", description: "Output directory" },
    format: { type: "string", default: "pem", description: "Output format" },
  },
  // ...
};
```

**Runtime access:**

```ts
runtime.config.defaultEnvironment      // top-level, typed from cli.config.ts schema
runtime.commandConfig.outputDir        // command-scoped, typed from manifest schema
```

**In `MockRuntime`**, both are provided directly:

```ts
const runtime = new MockRuntime({
  config: { defaultEnvironment: "staging", apiUrl: "https://staging.example.com" },
  commandConfig: { outputDir: "./dist", format: "pem" },
});
```

### Stdin

```ts
interface StdinInterface {
  isTTY: boolean;
  read(): Promise<string>;                  // read all of stdin at once
  lines(): AsyncIterable<string>;           // stream line by line
}
```

`isTTY` is `false` when stdin is piped, which is the signal that interactive prompts are unavailable. Commands that can operate in both modes should check this upfront:

```ts
run: async (args, runtime) => {
  const ids = runtime.stdin.isTTY
    ? [args.flags.id as string]             // interactive: take from flag
    : runtime.stdin.lines();               // piped: read from stdin
  for await (const id of ids) { ... }
}
```

`lines()` is preferred for large inputs — it processes data as it arrives without buffering the entire stream into memory. `read()` is convenient for small, structured inputs (e.g. a JSON payload piped in).

**Prompts and piped stdin:** if `runtime.prompt` is called when `stdin.isTTY` is `false`, the runtime throws immediately with a clear error:

```
Error: cannot prompt interactively — stdin is not a TTY.
       Pass required values as flags or pipe structured input instead.
```

This prevents commands from silently hanging when run non-interactively. Commands that want to support both modes should branch on `runtime.stdin.isTTY` before reaching any prompt call.

**In `MockRuntime`**, stdin is provided as a string or array of lines:

```ts
const runtime = new MockRuntime({
  stdin: "id-1\nid-2\nid-3",   // or: { lines: ["id-1", "id-2", "id-3"] }
});
```

`MockRuntime` sets `isTTY: false` when stdin is provided, `true` when omitted.

### Logging

Two global flags control log output: `--verbose` (operational detail for end users troubleshooting) and `--debug` (framework and command internals for developers). Both are off by default.

```ts
interface LogInterface {
  verbose(message: string): void;  // emitted when --verbose or --debug is active
  debug(message: string): void;    // emitted only when --debug is active
}
```

`--debug` is a superset of `--verbose` — enabling it activates both levels. All log output goes to **stderr** so it never pollutes piped stdout. Both levels are silently suppressed in `--json` mode.

```ts
// Command usage
runtime.log.verbose("Resolved config from ~/.config/myctl/config.toml");
runtime.log.debug("Fetching environments from https://api.example.com/envs");
```

The framework itself uses `runtime.log.debug()` for internal tracing (plugin discovery, arg parsing, completer resolution) so `--debug` gives command authors full visibility into framework behaviour without any extra instrumentation.

In `MockRuntime`, log calls are recorded and inspectable:

```ts
expect(runtime.log.calls).toContainEqual({
  level: "verbose",
  message: "Resolved config from ~/.config/myctl/config.toml",
});
```

### Signal Handling

The framework registers handlers for `SIGINT` (Ctrl+C) and `SIGTERM` at startup. When either is received:

1. `runtime.signal` is aborted — any code awaiting or passing this signal cancels immediately
2. `onExit` callbacks are called in registration order
3. Terminal state is restored (spinner stopped, prompt line cleared, cursor and echo mode reset)
4. Any subprocess spawned via `runtime.exec()` receives the signal and is awaited briefly before the process exits
5. Process exits with code `130` for SIGINT, `143` for SIGTERM

Commands use `runtime.signal` to propagate cancellation to in-flight work:

```ts
run: async (args, runtime) => {
  // fetch respects abort
  const res = await runtime.fetch(url, { signal: runtime.signal });

  // async iteration respects abort via the signal
  for await (const line of runtime.stdin.lines()) {
    if (runtime.signal.aborted) break;
    await process(line);
  }
}
```

`runtime.onExit()` is for cleanup that must run regardless of how the process exits — temp files, lock files, open handles:

```ts
run: async (args, runtime) => {
  const tmp = await writeTempFile(data);
  runtime.onExit(() => fs.unlinkSync(tmp));  // cleaned up on success, error, or signal
  await doWork(tmp);
}
```

The framework handles terminal cleanup automatically — commands do not need to restore cursor state or stop spinners manually on signal.

**In `MockRuntime`**, the signal can be aborted programmatically to test cancellation paths:

```ts
const runtime = new MockRuntime();
setTimeout(() => runtime.abortSignal(), 100);  // simulate Ctrl+C after 100ms
await myCommand.run(runtime.args, runtime);
expect(runtime.exitCode).toBe(130);
```

### Testing

The value of routing everything through the runtime is that a mock implementation covers the entire I/O surface:

```ts
const runtime = new MockRuntime({
  args: { flags: { environment: "staging" } },
  env: { API_KEY: "test-key" },
  fs: {
    "/home/user/.config/mycli/config.toml": `apiUrl = "https://staging.example.com"`
  },
  fetch: {
    "https://staging.example.com/services": [{ name: "api" }, { name: "worker" }]
  }
});

await myCommand.run(runtime.args, runtime);

expect(runtime.output.calls).toContainEqual({
  type: "table",
  rows: [{ name: "api" }, { name: "worker" }]
});
```

No globals patched, no temp files, no network. The test is a pure description of inputs and expected outputs.

-----

## Completion System

### Unified Resolution

A single `resolveCompletions()` function serves both shell tab completion and interactive prompts. Neither consumer is aware of the other.

```ts
interface CompletionSource {
  type: "static";
  values: string[];
} | {
  type: "dynamic";
  resolver: string;         // key into Command.completers
  cacheMs?: number;
  dependsOn?: string[];     // flag names whose values are passed as context
}

interface CompletionItem {
  value: string;
  description?: string;
  hint?: string;            // e.g. "(deprecated)", "[remote]"
}

interface CompletionRequest {
  command?: string;
  slot: SlotRef;
  partial: string;
  resolvedFlags: Record<string, unknown>;
  resolvedPositionals: string[];
}

interface CompletionResult {
  items: CompletionItem[];
  isExhaustive: boolean;    // false = there may be more (e.g. partial network results)
}

async function resolveCompletions(
  req: CompletionRequest,
  runtime: Runtime
): Promise<CompletionResult>
```

### Dynamic Completers

Commands declare dynamic completers in their module. The manifest references them by key. The full module is only imported when the cursor is on a slot that needs it.

```ts
// In the manifest (ArgSchema)
flags: {
  environment: { type: "string", complete: { type: "dynamic", resolver: "envs" } },
  service:     { type: "string", complete: { type: "dynamic", resolver: "services", dependsOn: ["environment"] } }
}

// In the command module
completers: {
  envs: async () => fetchEnvironments(),
  services: async ({ flags }) => fetchServices(flags.environment as string),
}
```

`dependsOn` means the engine only calls the `services` completer if `--environment` is already present in the token stream. In the interactive prompt, it re-fetches when the dependency value changes.

### Completer Context

```ts
interface CompleterContext {
  partial: string;
  flags: Record<string, unknown>;
  positionals: string[];
  runtime: Pick<Runtime, "exec" | "env">;
  signal?: AbortSignal;     // for prompt debouncing; ignored in shell completion
}
```

### Caching

```ts
// In-memory cache (shell completion — per process invocation)
const cache = new Map<string, { values: CompletionItem[]; expires: number }>();

// Cache key includes the values of dependsOn flags
const key = cacheKey(resolver, flags, dependsOn);
```

For shell completion, a filesystem cache at `~/.cache/<cli>/completions/` (keyed by a hash) survives between invocations. Always wrap dynamic completers with a timeout — a hanging completion is worse than an empty one:

```ts
async function resolveWithTimeout(source, ctx, ms = 2000) {
  try {
    return await Promise.race([
      resolve(source, ctx),
      new Promise<CompletionItem[]>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), ms)
      )
    ]);
  } catch {
    return [];
  }
}
```

-----

## Shell Completions

Install a shell function that calls the binary with a special flag:

```bash
# bash (simplified)
_mycli_completion() {
  COMPREPLY=($(mycli --complete -- "${COMP_WORDS[@]}"))
}
complete -F _mycli_completion mycli
```

When `--complete --` is detected, the binary:

1. Reads the token stream after `--`
1. Identifies which command and slot the cursor is on
1. Loads the manifest (no full import needed for static completions)
1. Calls `resolveCompletions()` and prints results to stdout

zsh and fish use slightly different output formats but the same resolution logic.

-----

## Interactive Prompt

### Prompt Types Derived from Schema

```ts
function promptTypeForSlot(slot: SlotDef): PromptType {
  if (!slot.complete) return "text";
  if (slot.multiple) return "multi-select";
  if (slot.complete.type === "static" && slot.complete.values.length <= 8) return "select";
  return "autocomplete";
}
```

| Type | When | Renders as |
|---|---|---|
| `text` | No completion source | Free text input |
| `select` | Static source, ≤8 values | Pick-one list |
| `autocomplete` | Dynamic source or >8 static values | Fuzzy search + re-fetch |
| `multi-select` | `multiple: true` + any completion source | Checkbox list (space to select, enter to confirm) |

Commands can drop into a fully interactive flow for unresolved required slots:

```ts
// Available on the runtime
runtime.prompt.fromSchema(schema, partialArgs);
```

This walks the schema, finds unresolved required slots, and presents them using the prompt type above — powered by the same `resolveCompletions()` as shell completion.

### Confirm Prompt

`confirm` is not schema-derived — it is an explicit call used for destructive actions before they are carried out:

```ts
const yes = await runtime.prompt.confirm("Delete 3 services? This cannot be undone.");
if (!yes) { runtime.exit(0); }
```

Returns `Promise<boolean>`. Renders as a `y/N` prompt in the terminal. Like all prompt calls, it throws if `stdin.isTTY` is `false` — commands that run non-interactively should gate destructive actions behind a `--yes` / `--force` flag rather than relying on confirm.

### Filtering Strategy

The `isExhaustive` flag on `CompletionResult` tells the prompt how to behave as the user types:

- **`isExhaustive: true`** → fetch once, filter in-memory as the user types
- **`isExhaustive: false`** → re-call the completer with the updated partial (e.g. a search API)

### Debouncing with AbortSignal

```ts
let abortController: AbortController | null = null;

const fetchDebounced = debounce(async (partial: string) => {
  abortController?.abort();
  abortController = new AbortController();
  const result = await resolveCompletions(
    { ..., partial },
    { signal: abortController.signal }
  );
  if (!abortController.signal.aborted) render(result.items);
}, 150);
```

### TTY Input Loop

The prompt reads raw bytes from stdin. Escape sequences (`\x1b[A` = up, `\x1b[C` = right, etc.) are accumulated via a small state machine. For the autocomplete dropdown: render below the current line using ANSI cursor movement, track how many lines were drawn, and erase before each re-render.

-----

## The Full Picture

```
CommandManifest
  └── ArgSchema
        └── SlotDef (flag / positional / subcommand)
              └── CompletionSource (static | dynamic)
                            │
                            ▼
                  resolveCompletions()        ← single resolution engine
                   /               \
        shell --complete        runtime.prompt.fromSchema()
        (print & exit)          (interactive input loop)
                                        │
                                promptTypeForSlot()
                                ├── "select"       → pick from list
                                ├── "autocomplete" → fuzzy + re-fetch
                                ├── "multi-select" → checkbox list
                                └── "text"         → free input
```

Command authors fill in their schema once and get shell completions, interactive prompts, and `--help` text for free.

-----

## Building a Specialized CLI

The framework is the engine. A specialized CLI is a thin product layer on top — it provides identity, commands, and distribution config without touching the engine internals.

```
┌─────────────────────────────────────┐
│           my-company-cli            │  ← product (your repo)
│                                     │
│  cli.config.ts   (identity)         │
│  commands/       (your plugins)     │
│  package.json    (build scripts)    │
└────────────────┬────────────────────┘
                 │ builds on
┌────────────────▼────────────────────┐
│               cape                  │  ← framework (this project)
│                                     │
│  runtime, arg parser, prompt        │
│  completion engine, plugin loader   │
└─────────────────────────────────────┘
```

### CLI Identity

A single `cli.config.ts` at the root of the product repo drives everything — binary name, display name, XDG paths, env vars, and branding. This file is the product boundary: it’s what a framework consumer fills in to get a fully branded, distributable CLI.

```ts
// cli.config.ts
import { defineConfig } from "cape";

export default defineConfig({
  name: "myctl",                        // binary name
  displayName: "MyCompany CLI",         // used in help text and prompts
  version: "1.0.0",                     // or: () => readPackageJson().version
  description: "Manage your MyCompany resources",

  // Drives runtime.fs.configPath(), cachePath(), dataPath()
  dirs: {
    config: "~/.config/myctl",
    cache:  "~/.cache/myctl",
    data:   "~/.local/share/myctl",
  },

  // Declares env vars all commands may access via runtime.env
  env: {
    MYCTL_TOKEN:   { description: "API token", required: true },
    MYCTL_API_URL: { description: "API base URL", default: "https://api.mycompany.com" },
  },

  theme: {
    accentColor: "#0066ff",
    helpHeader: {
      content: `
  ███╗   ███╗██╗   ██╗ ██████╗████████╗██╗
  ████╗ ████║╚██╗ ██╔╝██╔════╝╚══██╔══╝██║
  ██╔████╔██║ ╚████╔╝ ██║        ██║   ██║
      `.trim(),
      showOn: "top-level",  // "top-level" | "always"
    },
  },

  // Used by self-update and install script generation
  releases: {
    url: "https://github.com/mycompany/myctl/releases",
  },
});
```

### Build Pipeline

The framework provides a `build.ts` script that reads `cli.config.ts` and produces the binary and all install artifacts:

```ts
import config from "./cli.config.ts";

await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "bun",
  define: {
    // Identity is baked into the binary at compile time
    __CLI_NAME__:         JSON.stringify(config.name),
    __CLI_DISPLAY_NAME__: JSON.stringify(config.displayName),
    __CLI_VERSION__:      JSON.stringify(config.version),
  },
});

await generateInstallScript(config);      // dist/install.sh
await generateCompletionScripts(config);  // dist/completions/
await generateHomebrewFormula(config);    // dist/myctl.rb
await generateScoopManifest(config);      // dist/myctl.json
await generateNpmPackage(config);         // dist/npm/
```

The compiled binary has identity baked in — no external config file needs to be shipped alongside it.

### Distribution

Three tiers targeting different audiences:

**1. Direct download (curl install)**

```bash
# dist/install.sh — generated from cli.config.ts
#!/bin/sh
set -e

CLI_NAME="myctl"
VERSION="1.2.0"
INSTALL_DIR="${MYCTL_INSTALL_DIR:-/usr/local/bin}"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
[ "$ARCH" = "x86_64" ] && ARCH="x64"
[ "$ARCH" = "aarch64" ] && ARCH="arm64"

URL="https://github.com/mycompany/myctl/releases/download/v$VERSION/myctl-${OS}-${ARCH}"

echo "Installing myctl $VERSION..."
curl -fsSL "$URL" -o "$INSTALL_DIR/$CLI_NAME"
chmod +x "$INSTALL_DIR/$CLI_NAME"

# Offer to install shell completions
if [ -n "$SHELL" ]; then
  "$INSTALL_DIR/$CLI_NAME" completions install --shell=$(basename $SHELL) 2>/dev/null || true
fi

echo "Done. Run 'myctl --help' to get started."
```

Users run: `curl -fsSL https://mycompany.com/install.sh | sh`

**2. Package managers**

Since the output is a self-contained binary, package manifests are straightforward to generate. The npm approach is especially clean — publish a wrapper package that downloads the right platform binary on `postinstall`:

```
@mycompany/myctl/
  package.json      ("bin": { "myctl": "./bin/myctl" })
  postinstall.js    (downloads correct platform binary to ./bin/)
```

Users run: `npm install -g @mycompany/myctl`. They get npm’s version management for free with no Node.js runtime dependency at execution time.

**3. Self-update**

The framework provides a built-in `update` command. All the product config needs to supply is `releases.url`:

```ts
// Built-in command provided by the framework
run: async (args, runtime) => {
  const res = await runtime.fetch(`${config.releases.url}/latest.json`);
  const latest = await res.json();

  if (latest.version === __CLI_VERSION__) {
    runtime.print("Already up to date.");
    return;
  }

  const tmp = `${process.execPath}.tmp`;
  await downloadBinary(latest.url, tmp);
  fs.renameSync(tmp, process.execPath);
  runtime.output.success(`Updated to ${latest.version}`);
}
```

The framework can also do a non-blocking background check (at most once per day, result cached in `runtime.fs.cachePath("update-check.json")`) and show a subtle hint at the end of any command output.

### First-Run Experience

The `env` declarations in `cli.config.ts` drive an automatic setup flow. Any required env var without a configured value triggers `init` on first run:

```
$ myctl

  ███╗   ███╗██╗   ██╗ ██████╗████████╗██╗
  ...

  Welcome to MyCompany CLI v1.0.0

  Let's get you set up. You'll need an API token from:
  https://mycompany.com/settings/tokens

  ? API token: ████████████████████
  ? Default environment: › staging

  ✓ Config saved to ~/.config/myctl/config.toml
  ✓ Shell completions installed (bash)

  Run 'myctl --help' to see available commands.
```

This is a built-in `init` command in the framework — the product gets it for free just by declaring its required env vars in `cli.config.ts`.

Other built-in commands provided by the framework: `update` (self-update), `doctor` (plugin tree validation — see Subcommand Routing).

-----

## Future Improvements

### Runtime Extension by the Product

A product CLI often has cross-cutting concerns that every command needs — an authenticated API client, a resolved config object, a selected workspace. Without an extension mechanism, commands end up re-implementing that setup themselves.

The proposed solution is a generic `Runtime<TContext>` where `TContext` is the product-defined extension, combined with a middleware chain for wrapping command execution.

**Typed context**

```ts
// Framework base
interface Runtime<TContext = {}> {
  // ... base interface ...
  context: TContext;
}

// Product defines its context type and factory
interface MyContext {
  api: ApiClient;
  config: ResolvedConfig;
  workspace: string;
}

// cli.config.ts
export default defineConfig({
  contextFactory: defineContext<MyContext>((runtime) => {
    const config = loadConfigSync(runtime);
    return {
      api: new ApiClient(runtime.env["MYCTL_TOKEN"], config.apiUrl),
      config,
      workspace: runtime.env["MYCTL_WORKSPACE"] ?? config.defaultWorkspace,
    };
  }),
});
```

Commands are typed against the extended runtime — no setup boilerplate, fully typed:

```ts
const command: Command<MyContext> = {
  manifest: { ... },
  run: async (args, runtime) => {
    const services = await runtime.context.api.services.list(runtime.context.workspace);
    runtime.output.table(services);
  }
};
```

The framework invokes the factory once per command invocation, after args are parsed, and attaches the result to `runtime.context` before calling `run()`. Expensive properties should be exposed as lazy getters or async methods so they’re only resolved if actually accessed.

**Middleware**

For wrapping execution itself — auth checks, telemetry, error formatting:

```ts
// cli.config.ts
export default defineConfig({
  middleware: [
    authMiddleware,       // abort if not authenticated
    telemetryMiddleware,  // record command name + duration
    errorMiddleware,      // format known error types
  ],
});

type Middleware = (
  args: ParsedArgs,
  runtime: Runtime,
  next: () => Promise<void>
) => Promise<void>;

const authMiddleware: Middleware = async (args, runtime, next) => {
  if (!runtime.env["MYCTL_TOKEN"]) {
    runtime.printError("Not authenticated. Run 'myctl init' to set up.");
    runtime.exit(1);
  }
  await next();
};
```

Individual commands can opt out of specific middleware via the manifest (e.g. the `login` command skipping auth middleware):

```ts
interface CommandManifest {
  skipMiddleware?: string[];
}
```

**Execution flow**

```
cli.config.ts
  ├── contextFactory    → attached to runtime.context before run()
  └── middleware[]      → wrapped around run() in order

  request ──► middleware chain (auth → telemetry → error handling)
                    │
              contextFactory()
                    │
              command.run()    ← runtime.context.* fully typed
```

**Testing**

Tests bypass the factory and inject context directly, keeping command unit tests simple:

```ts
const runtime = new MockRuntime<MyContext>({
  context: {
    api: new MockApiClient({ services: [{ name: "api" }] }),
    config: { apiUrl: "https://staging.example.com" },
    workspace: "staging",
  },
});

await myCommand.run(runtime.args, runtime);
```

The factory is only exercised in integration tests.

**Why deferred:** introduces generics throughout the `Command` and `Runtime` types which adds meaningful complexity to the framework’s core interfaces. For v1, commands can build context manually in a shared `createContext(runtime)` helper — same pattern, without the framework needing to know about it. Revisit once the base interfaces are stable and the boilerplate cost in real commands becomes clear.

-----

### Process Isolation for Plugins

Commands could run in a `Bun.Worker` with a proxy runtime that serializes all I/O calls over IPC to a host process. The host enforces a capability policy per command (allowed paths, allowed hostnames, visible env vars) and records all calls for testing.

```
Host process (RuntimeHost)          Worker process
 - actual fs/network/stdio    ←──────  RuntimeProxy
 - enforces policy                     (same interface)
 - records calls for tests             command.run(args, proxy)
```

Benefits: stronger plugin sandboxing, call recording without any mocking infrastructure, policy-enforced capability limits.

Deferred because: serialization overhead for every I/O call, worker startup cost for short-lived commands, loss of stack trace context across the boundary, and added complexity. The runtime abstraction already provides the main testing benefit (single seam, mockable interface). Revisit when third-party plugin trust becomes a concern.

-----

## Build Order

```
arg parser → runtime interface → command loader → built-in commands
                                                ↘ completion engine
interactive prompt (parallel track)

cli.config.ts → build pipeline → binary + install artifacts
                              ↘ init command (first-run flow)
                              ↘ update command (self-update)
                              ↘ doctor command (conflict/validation)
```

The arg parser and runtime interface are foundational and independent of each other. The prompt can be built in parallel. Completions come last — they require a stable schema system.

The `cli.config.ts` / build pipeline work is independent of the engine and can be done any time after the runtime interface is stable. The `init`, `update`, and `doctor` built-in commands depend on both the runtime interface and the config shape being settled.
