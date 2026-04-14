# Commands

Commands are the core of a Cape CLI. Each command is a TypeScript file that exports a `defineCommand` call — a schema that describes its flags and positionals, and a `run` function that implements its logic.

---

## Anatomy of a command

<!-- golden: quickstart/commands/greet-filled.ts -->
```ts
import { defineCommand } from "../cli.config.ts";

export const greetCommand = defineCommand({
  name: "greet",
  description: "Greet someone by name",
  schema: {
    flags: {
      name: { type: "string", alias: "n", required: true, description: "Who to greet" },
      loud: { type: "boolean", alias: "l", description: "Shout it" },
    },
  },
  async run(args, runtime) {
    const greeting = `Hello, ${args.flags.name}!`;
    runtime.print(args.flags.loud ? greeting.toUpperCase() : greeting);
  },
});
```

Import `defineCommand` from your `cli.config.ts` — not from `"cape"` directly. This gives TypeScript the full config type so `runtime.config` is typed in your command.

Register the command in `main.ts`:

<!-- golden: quickstart/main-with-greet.ts -->
```ts
import { createCli } from "cape";
import config from "./cli.config.ts";
import { helloCommand } from "./commands/hello.ts";
import { greetCommand } from "./commands/greet.ts";

const cli = createCli(config, [helloCommand, greetCommand]);

await cli.run();
```

---

## Flags

Each key in `schema.flags` is a flag definition:

```ts
schema: {
  flags: {
    region: {
      type: "string",           // "string" | "number" | "boolean"
      alias: "r",               // short form: -r
      required: true,           // must be provided (or prompted interactively)
      default: "us-east-1",     // used when flag is absent (makes it non-required)
      description: "AWS region", // shown in --help
      multiple: false,          // true → accepts the flag more than once (string[])
      complete: { ... },        // tab-completion source (see Tab completion)
      prompt: false,            // true → confirm prompt for boolean flags
    },
  },
}
```

### Types

| `type` | TypeScript value | Example |
|---|---|---|
| `"string"` | `string` (or `string \| undefined`) | `--name Alice` |
| `"number"` | `number` (or `number \| undefined`) | `--count 5` |
| `"boolean"` | `boolean` (always) | `--verbose` |

Boolean flags are switches — they default to `false` and are set to `true` when present. They never take a value argument.

### `required`

When `required: true` is set on a string or number flag and the flag is not provided, Cape:

1. **In a TTY**: prompts the user interactively (see [Required flags and automatic prompting](#required-flags-and-automatic-prompting)).
2. **In a script / pipe**: exits with a clear error message.

Required booleans are not meaningful — use `prompt: true` instead (see below).

### `default`

A flag with a `default` is never `undefined` in `args.flags` — TypeScript knows this. Providing a default also makes the flag non-required (the default is used when the flag is absent).

```ts
flags: {
  format: { type: "string", default: "table", description: "Output format" },
}
// args.flags.format is always `string` — never undefined
```

### `multiple`

A flag with `multiple: true` may be passed more than once. The value in `args.flags` is an array.

```ts
flags: {
  tag: { type: "string", multiple: true, description: "Tag to apply (repeatable)" },
}
// my-tool deploy --tag v1 --tag latest
// args.flags.tag → ["v1", "latest"]
```

### `alias`

Single-character short form. Aliases use a single dash (`-r`) vs the full form (`--region`).

### `prompt: true`

For boolean flags only. When the flag is not passed, Cape shows a yes/no confirm prompt:

```ts
flags: {
  force: {
    type: "boolean",
    prompt: true,
    description: "Skip confirmation checks",
  },
}
```

```
$ my-tool delete
? Skip confirmation checks (y/N) › _
```

Passing `--force` directly skips the prompt.

---

## Positionals

Positionals are ordered non-flag arguments:

```ts
schema: {
  positionals: [
    { name: "source", description: "Source path" },
    { name: "dest",   description: "Destination path" },
  ],
}
// my-tool copy ./src ./dst
// args.positionals → ["./src", "./dst"]
```

### Variadic positionals

The last positional can be variadic — it captures all remaining arguments as an array:

```ts
schema: {
  positionals: [
    { name: "files", variadic: true },
  ],
}
// my-tool process a.ts b.ts c.ts
// args.positionals → ["a.ts", "b.ts", "c.ts"]
```

Positionals also support `complete` for tab-completion (see [Tab completion](#tab-completion)).

---

## Subcommands

A command can have subcommands instead of (or alongside) a direct `run`. Use `defineSubcommand` from `cli.config.ts` for each sub:

```ts
import { defineCommand, defineSubcommand } from "../cli.config.ts";

const startSub = defineSubcommand({
  name: "start",
  description: "Start the service",
  schema: {
    flags: {
      detach: { type: "boolean", alias: "d", description: "Run in background" },
    },
  },
  async run(args, runtime) {
    runtime.print(args.flags.detach ? "Starting in background..." : "Starting...");
  },
});

const stopSub = defineSubcommand({
  name: "stop",
  description: "Stop the service",
  async run(_args, runtime) {
    runtime.print("Stopping...");
  },
});

export const serviceCommand = defineCommand({
  name: "service",
  description: "Manage the service",
  subcommands: [startSub, stopSub],
  // no `run` — showing help when invoked without a subcommand
});
```

```
$ my-tool service start --detach
$ my-tool service stop
$ my-tool service --help       # shows the subcommand list
```

When a command has subcommands but no `run`, invoking it without a subcommand shows the command's help page automatically.

### Flags on parent vs subcommand

Flags can be declared on the parent command, the subcommand, or both. Parent flags are valid for all subcommands; subcommand flags are specific to that sub. Both sets appear in the appropriate `--help` pages.

---

## Aliases

Commands and subcommands can declare aliases — alternative names that work at the call site:

```ts
export const deployCommand = defineCommand({
  name: "deploy",
  aliases: ["d", "ship"],
  description: "Deploy the service",
  async run(_args, runtime) { ... },
});
```

```
$ my-tool deploy   # canonical name
$ my-tool ship     # alias
$ my-tool d        # alias
```

Aliases appear in help output alongside the primary name.

---

## Accessing args in `run`

`args` is a fully typed object derived from your `schema`:

```ts
async run(args, runtime) {
  // Flags — typed from schema
  const name: string        = args.flags.name;      // required string → never undefined
  const count: number       = args.flags.count;     // has default → never undefined
  const tags: string[]      = args.flags.tag;       // multiple: true
  const verbose: boolean    = args.flags.verbose;   // boolean → always boolean
  const output: string | undefined = args.flags.output; // optional string

  // Positionals — always string[]
  const [src, dest] = args.positionals;

  // Passthrough — tokens after `--`
  // my-tool run -- --some-flag value
  const passthroughArgs = args.passthrough;

  // Was this flag explicitly set by the user (not just defaulted)?
  if (args.provided.has("output")) {
    runtime.print("Output flag was explicitly set");
  }
}
```

### Type inference

Cape infers the TypeScript type of each flag from its schema — no casts needed:

| Schema | Inferred type |
|---|---|
| `{ type: "string", required: true }` | `string` |
| `{ type: "string", default: "x" }` | `string` |
| `{ type: "string" }` | `string \| undefined` |
| `{ type: "number" }` | `number \| undefined` |
| `{ type: "boolean" }` | `boolean` |
| `{ type: "string", multiple: true }` | `string[]` |

### `args.provided`

A `Set<string>` of flag names that were **explicitly passed** on the command line, excluding defaults. Useful when you need to distinguish "the user set this to the same value as the default" from "this was not provided":

```ts
flags: { env: { type: "string", default: "staging" } }

// my-tool deploy              → args.provided.has("env") === false
// my-tool deploy --env staging → args.provided.has("env") === true
```

### Passthrough args

Tokens after `--` are collected in `args.passthrough` and never parsed as flags. Useful when your command wraps another tool:

```ts
// my-tool run -- --watch --open
// args.passthrough → ["--watch", "--open"]
async run(args, runtime) {
  await runtime.exec.run(["vite", ...args.passthrough]);
}
```

---

## Tab completion

Add a `complete` source to any flag or positional to enable shell tab completion:

### Static choices

```ts
flags: {
  env: {
    type: "string",
    complete: {
      type: "static",
      values: ["development", "staging", "production"],
    },
  },
}
```

Values can be plain strings (`label = value`) or `{ label, value }` objects for display/value separation — see the note in [Required flags and automatic prompting](#required-flags-and-automatic-prompting).

### Dynamic choices

```ts
flags: {
  service: {
    type: "string",
    complete: {
      type: "dynamic",
      fetch: async (ctx) => {
        const services = await fetchServices(ctx.partial);
        return services.map((s) => s.name);
      },
      cacheMs: 30_000,   // cache results for 30 seconds
      timeoutMs: 3_000,  // abort and return [] if fetch takes > 3s (default: 5s)
    },
  },
}
```

`ctx` provides:
- `ctx.partial` — the partial word being completed
- `ctx.flags` — other flag values already on the command line (best-effort)

### Dependent completions

When a completion depends on the value of another flag, declare `dependsOn` so Cape waits for that flag to be resolved before fetching:

```ts
flags: {
  region: { type: "string", complete: { type: "static", values: ["us-east-1", "eu-west-1"] } },
  cluster: {
    type: "string",
    complete: {
      type: "dynamic",
      dependsOn: ["region"],
      fetch: async (ctx) => fetchClusters(ctx.flags["region"] as string),
    },
  },
}
```

Install completions with `my-tool completions install` (or `cape run -- completions install` in dev).

---

## Required flags and automatic prompting

When a required flag is missing, Cape maps the `complete` source to the most appropriate interactive prompt:

| `complete` | Choices count | Prompt shown |
|---|---|---|
| None | — | Free-text input |
| `static` | ≤ 8 | `select` (arrow-key list) |
| `static` | > 8 | `autocomplete` (type to filter) |
| `dynamic` | — | `autocomplete` (live fetch) |

This means the same schema declaration drives both tab completion (in the shell) and the interactive fallback prompt (in the terminal). No extra code required.

For `{ label, value }` completion choices, the prompt displays the label and stores the value — so `args.flags.env` is always the value string, whether the user typed `--env production` or selected "Production (eu-west-1)" from the autocomplete list.

---

## Global flags

Every command automatically supports these flags — they are handled by the framework before your `run` is called:

| Flag | Alias | Description |
|---|---|---|
| `--help` | `-h` | Show help for this command |
| `--version` | | Show the CLI version |
| `--json` | | Emit output as JSON (see [runtime.output](../api/output.md)) |
| `--quiet` | `-q` | Suppress all output except errors |
| `--no-color` | | Disable ANSI color and formatting |
| `--verbose` | `-v` | Enable verbose log output |
| `--debug` | | Enable debug log output (superset of `--verbose`) |
| `--config` | | Override config file location |

Your command code does not need to check these — Cape applies them to the runtime before calling `run`. You can read the current verbosity level through `runtime.log`:

```ts
runtime.log.verbose("Detailed step output");  // only shown with --verbose or --debug
runtime.log.debug("Raw API response", data);   // only shown with --debug
```

---

## Built-in commands

Cape injects a set of built-in commands into every CLI. You can shadow any of them by registering a command with the same name.

| Command | Description |
|---|---|
| `init` | First-run setup: configure credentials, install shell completions |
| `completions generate` | Print the shell completion script to stdout |
| `completions install` | Install completions for the detected shell |
| `plugin list` | List all discovered plugins |
| `plugin create` | Scaffold a new plugin |
| `plugin init` | Regenerate plugin type definitions |

The `plugin` name is reserved and cannot be shadowed.
