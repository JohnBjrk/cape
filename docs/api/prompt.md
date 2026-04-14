# runtime.prompt

`runtime.prompt` provides interactive prompt methods, all pre-bound to the command's `AbortSignal`. You don't need to import anything beyond `runtime` — just call `runtime.prompt.text(...)` etc. directly.

All prompts require a TTY. If stdin is not a TTY (CI, pipe, script), they throw [`NonTtyError`](#errors). If the user presses `Ctrl+C` or `Escape`, they throw [`PromptCancelledError`](#errors).

---

## Errors

### `NonTtyError`

Thrown when a prompt is invoked without an interactive terminal. Catch it when you want to provide a non-interactive fallback, or let it propagate — Cape will print a clear error message.

```ts
try {
  const name = await runtime.prompt.text({ message: "Your name" });
} catch (err) {
  if (err instanceof runtime.prompt.NonTtyError) {
    runtime.printError("Pass --name to run non-interactively.");
    runtime.exit(1);
  }
  throw err;
}
```

The `NonTtyError` and `PromptCancelledError` classes are available on `runtime.prompt` so you don't need a separate import.

### `PromptCancelledError`

Thrown when the user presses `Ctrl+C` or `Escape` to cancel a prompt. Cape propagates Ctrl+C as a cancellation — the command exits cleanly without a stack trace.

---

## text

Free-form text input. Returns the entered string.

```ts
const name = await runtime.prompt.text({ message: "Service name" });
```

With a pre-filled default shown in the input field:

```ts
const region = await runtime.prompt.text({
  message: "Deploy region",
  default: "us-east-1",
});
```

With validation — return an error string to reject, `undefined` to accept. A common pattern is to use the prompt as a fallback when a flag is not provided:

<!-- golden: api/prompt/create.ts -->
```ts
import { defineCommand } from "../cli.config.ts";

export const createCommand = defineCommand({
  name: "create",
  description: "Create a new service",
  schema: {
    flags: {
      name: { type: "string", description: "Service name" },
    },
  },
  async run(args, runtime) {
    const name = args.flags.name ?? await runtime.prompt.text({
      message: "Service name",
      validate: (v) => {
        if (!v.trim()) return "Name cannot be empty";
        if (!/^[a-z][a-z0-9-]*$/.test(v)) return "Use lowercase letters, numbers, and hyphens";
      },
    });
    runtime.output.success(`Created service "${name}"`);
  },
});
```

---

## confirm

Yes/no question. Returns `true` or `false`.

```ts
const proceed = await runtime.prompt.confirm({ message: "Deploy to production?" });
if (!proceed) return;
```

With a default that the user can accept by pressing Enter:

```ts
// Default: no (shows "y/N")
const deleteAll = await runtime.prompt.confirm({
  message: "Delete all records?",
  default: false,
});

// Default: yes (shows "Y/n")
const runMigrations = await runtime.prompt.confirm({
  message: "Run migrations?",
  default: true,
});
```

**Automatic prompting**: boolean flags with `prompt: true` in the schema will automatically show a confirm prompt when the flag is not passed:

<!-- golden: api/prompt/wipe.ts -->
```ts
import { defineCommand } from "../cli.config.ts";

export const wipeCommand = defineCommand({
  name: "wipe",
  description: "Delete all data in an environment",
  schema: {
    flags: {
      env:   { type: "string",  required: true, description: "Target environment" },
      force: { type: "boolean", prompt: true,   description: "Confirm deletion" },
    },
  },
  async run(args, runtime) {
    if (!args.flags.force) {
      runtime.print("Aborted.");
      return;
    }
    runtime.output.success(`Wiped ${args.flags.env}`);
  },
});
```

---

## select

Single choice from a fixed list. Returns the selected value. When declared as a `required` flag with a `static` completion source of ≤ 8 choices, Cape shows a select prompt automatically — no `runtime.prompt.select()` call needed:

<!-- golden: api/prompt/release.ts -->
```ts
import { defineCommand } from "../cli.config.ts";

export const releaseCommand = defineCommand({
  name: "release",
  description: "Release to an environment",
  schema: {
    flags: {
      env: {
        type: "string",
        required: true,
        description: "Target environment",
        complete: {
          type: "static",
          values: ["development", "staging", "production"],
        },
      },
    },
  },
  async run(args, runtime) {
    runtime.output.success(`Released to ${args.flags.env}`);
  },
});
```

You can also call `runtime.prompt.select()` directly when the prompt is not tied to a flag:

```ts
const env = await runtime.prompt.select({
  message: "Target environment",
  choices: ["development", "staging", "production"],
  default: "staging",
});
```

**Keys**: `↑`/`↓` to move, `Enter` to select. Type a letter to jump to the first matching choice.

### Label/value choices

When the display text should differ from the submitted value, pass `{ label, value }` objects:

```ts
const region = await runtime.prompt.select({
  message: "Region",
  choices: [
    { label: "US East (N. Virginia)",  value: "us-east-1" },
    { label: "EU West (Ireland)",       value: "eu-west-1" },
    { label: "AP Southeast (Singapore)", value: "ap-southeast-1" },
  ],
});
// region === "us-east-1" (the value, not the label)
```

The prompt displays the label; the returned string is the value.

---

## multiSelect

Multiple choices from a fixed list. Returns an array of selected values.

```ts
const services = await runtime.prompt.multiSelect({
  message: "Services to restart",
  choices: ["api", "worker", "scheduler", "frontend"],
});
```

With pre-checked defaults:

```ts
const features = await runtime.prompt.multiSelect({
  message: "Enable features",
  choices: ["metrics", "tracing", "profiling", "audit-log"],
  defaults: ["metrics", "tracing"],
});
```

**Keys**: `↑`/`↓` to move, `Space` to toggle, `a` to select/deselect all, `Enter` to confirm.

Label/value objects work here too — the prompt displays labels and returns the values of the checked choices.

A common pattern is to use a repeatable flag as the non-interactive equivalent, and fall back to `multiSelect` when the flag is not provided:

<!-- golden: api/prompt/tag.ts -->
```ts
import { defineCommand } from "../cli.config.ts";

export const tagCommand = defineCommand({
  name: "tag",
  description: "Apply labels to a service",
  schema: {
    flags: {
      service: { type: "string", required: true, description: "Target service" },
      label:   { type: "string", multiple: true, description: "Labels to apply (repeatable)" },
    },
  },
  async run(args, runtime) {
    const labels = args.provided.has("label")
      ? args.flags.label
      : await runtime.prompt.multiSelect({
          message: "Select labels to apply",
          choices: ["stable", "canary", "deprecated", "internal", "public", "beta"],
        });

    if (labels.length === 0) {
      runtime.print("No labels applied.");
      return;
    }
    runtime.output.success(`Applied to ${args.flags.service}: ${labels.join(", ")}`);
  },
});
```

---

## autocomplete

Text input with live-filtered suggestions. Returns the selected or typed value. Use this for long lists where a `select` would be unwieldy, or for dynamic suggestions fetched from an API.

### Static choices

Choices are filtered locally as the user types:

```ts
const service = await runtime.prompt.autocomplete({
  message: "Service",
  choices: ["api-gateway", "auth-service", "billing", "data-pipeline", "frontend", "worker"],
});
```

### Dynamic choices

Pass an async function. It receives the current query string and an `AbortSignal` (aborted when a new query supersedes the current fetch). Results are debounced automatically.

<!-- golden: api/prompt/logs.ts -->
```ts
import { defineCommand } from "../cli.config.ts";

export const logsCommand = defineCommand({
  name: "logs",
  description: "Tail logs for a service",
  schema: {
    flags: {
      service: { type: "string", description: "Service name" },
    },
  },
  async run(args, runtime) {
    const service = args.flags.service ?? await runtime.prompt.autocomplete({
      message: "Service",
      choices: async (query, signal) => {
        // In production this would fetch from an API
        const all = ["api-gateway", "auth-service", "billing", "data-pipeline", "frontend"];
        return all.filter((s) => s.includes(query));
      },
    });
    runtime.output.success(`Tailing logs for ${service}...`);
  },
});
```

Or fetching from a real API:

```ts
const repo = await runtime.prompt.autocomplete({
  message: "Repository",
  choices: async (query, signal) => {
    const results = await runtime.http.get(`/api/repos?q=${query}`, { signal });
    return results.map((r) => r.name);
  },
});
```

### Label/value choices

As with `select`, choices can be `{ label, value }` objects. The prompt filters and displays labels; the returned string is the value of the selected choice.

```ts
const cluster = await runtime.prompt.autocomplete({
  message: "Cluster",
  choices: async (query, signal) => {
    const clusters = await fetchClusters(query, signal);
    return clusters.map((c) => ({
      label: `${c.name}  (${c.region}, ${c.nodeCount} nodes)`,
      value: c.id,
    }));
  },
});
// cluster === "cluster-abc123" (the id, not the display label)
```

**Keys**: type to filter, `↑`/`↓` to navigate, `Tab` to fill in the highlighted choice, `Enter` to select.

---

## Flags that prompt automatically

You usually don't need to call `runtime.prompt` directly for flag values — Cape handles this for you.

**Required string/number flags**: if the flag is not provided, Cape shows the appropriate prompt based on the flag's `complete` source:

```ts
schema: {
  flags: {
    name: {
      type: "string",
      required: true,
      description: "Service name",
      // No complete source → text prompt
    },
    env: {
      type: "string",
      required: true,
      description: "Target environment",
      complete: {
        type: "static",
        values: ["development", "staging", "production"],
        // ≤8 choices → select prompt
      },
    },
    region: {
      type: "string",
      required: true,
      description: "Deploy region",
      complete: {
        type: "dynamic",
        fetch: async () => fetchRegions(),
        // dynamic source → autocomplete prompt
      },
    },
  },
}
```

**Boolean flags with `prompt: true`**: show a confirm prompt when not passed:

```ts
schema: {
  flags: {
    force: {
      type: "boolean",
      prompt: true,
      description: "Skip confirmation checks",
    },
  },
}
```

When `--force` is not passed, the user sees:

```
? Skip confirmation checks (y/N)
```

When a flag *is* provided on the command line, the prompt is skipped entirely. This means the same command works both interactively and in scripts:

```sh
my-tool deploy                     # interactive: prompts for env, region, etc.
my-tool deploy --env staging --region eu-west-1  # non-interactive: no prompts
```
