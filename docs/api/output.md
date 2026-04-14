# runtime.output

`runtime.output` is the primary way commands write to the terminal. It adapts automatically to the environment: interactive output (tables, spinners, progress bars) in a TTY, plain machine-readable output when piped. The global `--json`, `--quiet`, and `--no-color` flags are handled transparently — your command code doesn't need to check them.

---

## Text output

### `print(text)` / `runtime.print(text)`

Write a plain line to stdout. `runtime.print(text)` and `runtime.output.print(text)` are identical.

```ts
async run(args, runtime) {
  runtime.print("Starting sync...");
  // ... do work
  runtime.print("Done.");
}
```

### `success(message)`

Print a green `✓` checkmark followed by the message. Silent when `--quiet` is passed.

```ts
runtime.output.success("Deployed my-service v1.4.2");
// ✓ Deployed my-service v1.4.2
```

### `warn(message)`

Print a yellow `⚠` warning to **stderr**. Always shown, even when `--quiet` is active.

```ts
runtime.output.warn("Config file not found, using defaults");
// ⚠ Config file not found, using defaults
```

A command combining `success` and `warn`:

<!-- golden: api/output/check.ts -->
```ts
import { defineCommand } from "../cli.config.ts";

export const checkCommand = defineCommand({
  name: "check",
  description: "Check service health",
  schema: {
    flags: {
      service: { type: "string", required: true, description: "Service name" },
    },
  },
  async run(args, runtime) {
    runtime.output.success(`${args.flags.service} is running`);
    runtime.output.warn("1 unhealthy replica detected — consider scaling up");
  },
});
```

### `printError(text)` / `runtime.printError(text)`

Write a raw line to stderr. No prefix or formatting applied. Use `warn()` when you want the standard warning style.

---

## Structured output

### `table(rows, opts?)`

Render an array of row objects as a table.

- **TTY**: box-drawing table with bold headers and aligned columns.
- **Pipe** (`my-tool list | grep ...`): tab-separated values — headers on the first line, one row per line.

<!-- golden: api/output/services.ts -->
```ts
import { defineCommand } from "../cli.config.ts";

export const servicesCommand = defineCommand({
  name: "services",
  description: "List running services",
  async run(_args, runtime) {
    runtime.output.table([
      { Name: "api",      Status: "running", Replicas: 3 },
      { Name: "worker",   Status: "stopped", Replicas: 0 },
      { Name: "frontend", Status: "running", Replicas: 2 },
    ]);
    runtime.print("");
    runtime.output.list(["api", "worker", "frontend"]);
  },
});
```

TTY output:

```
┌────────────┬─────────┬──────────┐
│ Name       │ Status  │ Replicas │
├────────────┼─────────┼──────────┤
│ api        │ running │ 3        │
│ worker     │ stopped │ 0        │
│ frontend   │ running │ 2        │
└────────────┴─────────┴──────────┘
```

Pipe output:

```
Name	Status	Replicas
api	running	3
worker	stopped	0
frontend	running	2
```

**Column order**: columns default to the key order of the first row. Pass `opts.columns` to override:

```ts
runtime.output.table(rows, { columns: ["Status", "Name", "Replicas"] });
```

### `list(items)`

Render a list of strings.

- **TTY**: cyan bullet `•` before each item.
- **Pipe**: one item per line, no decoration.

```ts
runtime.output.list(["staging", "production", "canary"]);
//   • staging
//   • production
//   • canary
```

---

## JSON mode

### `--json` global flag

Any command automatically supports `--json`. When passed, all output is buffered and emitted as a single JSON object at the end of the command. Your command code doesn't change — the same `table()`, `list()`, `success()`, and `print()` calls work regardless.

```sh
my-tool services list --json
```

```json
{
  "results": [
    { "Name": "api", "Status": "running", "Replicas": 3 },
    { "Name": "worker", "Status": "stopped", "Replicas": 0 }
  ]
}
```

The output shape depends on what the command emits:

| Command output | JSON shape |
|---|---|
| A single `table()` or `json()` | The value unwrapped |
| Multiple structured results | `{ "results": [...] }` |
| Only `print()` / `success()` lines | `{ "output": [...] }` |
| Mixed text and structured results | `{ "output": [...], "results": [...] }` |

### `json(value)`

Emit a value as pretty-printed JSON immediately, bypassing `--quiet`. Use this when a command's primary output *is* structured data and the default format should be JSON.

<!-- golden: api/output/info.ts -->
```ts
import { defineCommand } from "../cli.config.ts";

export const infoCommand = defineCommand({
  name: "info",
  description: "Show service details",
  schema: {
    flags: {
      service: { type: "string", required: true, description: "Service name" },
    },
  },
  async run(args, runtime) {
    runtime.output.json({
      name: args.flags.service,
      status: "running",
      version: "1.4.2",
      uptime: "3d 14h",
    });
  },
});
```

<!-- golden: api/output/info-json.txt output -->
```text
{
  "name": "api",
  "status": "running",
  "version": "1.4.2",
  "uptime": "3d 14h"
}
```

This also works correctly under `--json` — the value is captured as a result rather than printed inline.

---

## Spinner

### `spinner(message)` → `Spinner`

Start a spinning animation with a message. Returns a `Spinner` handle.

In a non-TTY environment (pipe, CI), the spinner is suppressed — `succeed()` and `fail()` still emit a line.

```ts
const spinner = runtime.output.spinner("Fetching config...");

try {
  const config = await fetchRemoteConfig();
  spinner.succeed("Config loaded");
} catch (err) {
  spinner.fail("Failed to load config");
  throw err;
}
```

### `withSpinner(message, fn)` → `Promise<T>`

Convenience wrapper: starts a spinner, calls `fn`, then automatically calls `succeed()` or `fail()` depending on whether `fn` resolves or throws.

<!-- golden: api/output/deploy.ts -->
```ts
import { defineCommand } from "../cli.config.ts";

export const deployCommand = defineCommand({
  name: "deploy",
  description: "Deploy a service",
  schema: {
    flags: {
      service: { type: "string", required: true, description: "Service to deploy" },
      env:     { type: "string", default: "staging", description: "Target environment" },
    },
  },
  async run(args, runtime) {
    const result = await runtime.output.withSpinner(
      `Deploying ${args.flags.service} to ${args.flags.env}...`,
      async (spinner) => {
        spinner.update("Building image...");
        await Bun.sleep(0);
        spinner.update("Pushing to registry...");
        await Bun.sleep(0);
        return { tag: "v1.4.2" };
      },
    );
    runtime.output.success(
      `Deployed ${args.flags.service} ${result.tag} to ${args.flags.env}`,
    );
  },
});
```

**`Spinner` methods:**

| Method | Description |
|---|---|
| `update(message)` | Change the spinner label while it's running |
| `succeed(message?)` | Stop with a green `✓`. Defaults to the current message. |
| `fail(message?)` | Stop with a red `✗` to stderr. Defaults to the current message. |
| `stop()` | Stop and erase the spinner without printing anything. |

### `withSpinner(message, fn)` → `Promise<T>`

Convenience wrapper: starts a spinner, calls `fn`, then automatically calls `succeed()` or `fail()` depending on whether `fn` resolves or throws.

```ts
const result = await runtime.output.withSpinner("Deploying...", async (spinner) => {
  spinner.update("Building image...");
  await buildImage();
  spinner.update("Pushing to registry...");
  await pushImage();
  return { tag: "v1.4.2" };
});

// spinner.succeed() called automatically with "Deploying..."
```

---

## Progress bar

### `progressBar(total)` → `ProgressBar`

Create a progress bar for a known number of steps. In a non-TTY environment, the bar is suppressed — `done()` still emits a line if a message is passed.

```ts
const bar = runtime.output.progressBar(files.length);

for (const file of files) {
  await processFile(file);
  bar.tick();
}

bar.done("All files processed");
```

The bar renders inline as:

```
[===================>         ] 22/40
```

**`ProgressBar` methods:**

| Method | Description |
|---|---|
| `tick(n?)` | Advance by `n` steps (default: 1) |
| `setTotal(n)` | Update the total (useful when the count isn't known upfront) |
| `done(message?)` | Mark complete and optionally print a final message |

### `withProgressBar(total, fn)` → `Promise<T>`

Convenience wrapper: creates a bar, passes a `tick` callback to `fn`, and calls `done()` when `fn` finishes.

<!-- golden: api/output/migrate.ts -->
```ts
import { defineCommand } from "../cli.config.ts";

export const migrateCommand = defineCommand({
  name: "migrate",
  description: "Run database migrations",
  schema: {
    flags: {
      steps: { type: "number", default: 3, description: "Number of migrations to run" },
    },
  },
  async run(args, runtime) {
    const migrations = Array.from(
      { length: args.flags.steps },
      (_, i) => `migration_00${i + 1}`,
    );
    await runtime.output.withProgressBar(migrations.length, async (tick) => {
      for (const migration of migrations) {
        await Bun.sleep(0);
        runtime.log.verbose(`Applied ${migration}`);
        tick();
      }
    });
    runtime.output.success(`Applied ${migrations.length} migrations`);
  },
});
```

---

## Global flags

### `--quiet`

Suppresses `success()` and `print()` / `output.print()`. Warnings and errors still appear. Structured results (`table()`, `list()`, `json()`) are also suppressed in TTY mode but captured in `--json` mode.

### `--no-color`

Disables all ANSI colour and formatting. Output remains structured (tables use box-drawing characters, bullets are plain `•`) but without colour. Useful for logs or terminals that don't support colour.

### `--json` + `--quiet`

When both flags are present, `print()` / `success()` lines are excluded from the JSON output. Only structured results (`table()`, `list()`, `json()`) appear in the final object.
