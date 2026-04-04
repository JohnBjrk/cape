# Config Files

Cape provides a two-level config system: **top-level** keys that apply to the whole CLI, and **command-scoped** keys that are only exposed to a specific command. Both live in the same TOML file.

---

## Declaring the schema

You declare what config keys exist — and what their defaults are — directly alongside the rest of your CLI definition. There's no separate config file to maintain.

### Top-level keys — `cli.config.ts`

Top-level keys are global to the CLI (API URL, default environment, etc.). Declare them on `config` in your `defineConfig` call:

```ts
// cli.config.ts
import { defineConfig } from "cape";

export default defineConfig({
  name: "myctl",
  version: "1.0.0",
  description: "My CLI tool",

  config: {
    apiUrl: {
      type: "string",
      default: "https://api.example.com",
      description: "Base URL for the API",
    },
    defaultEnvironment: {
      type: "string",
      default: "staging",
      description: "Environment to target when none is specified",
    },
    timeout: {
      type: "number",
      default: 30,
      description: "Request timeout in seconds",
    },
  },
});
```

These values are available at runtime as `runtime.config`:

```ts
async run(args, runtime) {
  const url = runtime.config.apiUrl as string;
  const env = runtime.config.defaultEnvironment as string;
}
```

### Command-scoped keys — `defineCommand`

Command-scoped keys live in a `[commandName]` section in the config file and are only exposed to that command. Declare them on `config` in your `defineCommand` call:

```ts
import { defineCommand } from "cape";

export const deployCommand = defineCommand({
  name: "deploy",
  description: "Deploy to an environment",

  schema: {
    flags: {
      env: { type: "string", description: "Target environment" },
    },
  },

  config: {
    strategy: {
      type: "string",
      default: "rolling",
      description: "Deployment strategy (rolling, blue-green)",
    },
    timeout: {
      type: "number",
      default: 300,
      description: "Deployment timeout in seconds",
    },
  },

  async run(args, runtime) {
    const strategy = runtime.commandConfig.strategy as string; // "rolling"
    const timeout  = runtime.commandConfig.timeout as number;  // 300
  },
});
```

Command-scoped config is available at runtime as `runtime.commandConfig`. The values come from the `[deploy]` section of the config file, not the top-level keys.

### Subcommands share the parent's section

Subcommands read from their parent command's section. A `deploy staging` subcommand reads from `[deploy]`, not a separate `[deploy/staging]` section. If a subcommand declares its own `config`, those keys are merged into the same section:

```ts
defineSubcommand({
  name: "staging",
  config: {
    approvalRequired: { type: "boolean", default: false },
  },
  async run(args, runtime) {
    // runtime.commandConfig has both deploy's and staging's keys
    const strategy = runtime.commandConfig.strategy as string;
    const approval = runtime.commandConfig.approvalRequired as boolean;
  },
});
```

---

## The config file

Values are stored in TOML. Cape looks for config files in two places and merges them:

### User config — `~/.config/myctl/config.toml`

Applies to all projects on this machine. Good for personal preferences and credentials-adjacent settings:

```toml
# ~/.config/myctl/config.toml

apiUrl = "https://api.example.com"
defaultEnvironment = "staging"

[deploy]
strategy = "rolling"
timeout = 300

[generate]
outputDir = "./dist"
```

### Repo-local config — `.myctl.toml`

Place a `.myctl.toml` file anywhere in your project tree. Cape walks up from the current working directory until it finds one, stopping at the git root (`.git` directory). This is great for team defaults checked into the repository:

```toml
# .myctl.toml  (committed to the repo)

defaultEnvironment = "staging"

[deploy]
strategy = "blue-green"
```

Repo-local values override user config. A developer's personal `~/.config/myctl/config.toml` can still override individual keys on top of the repo defaults.

### Priority order (highest to lowest)

1. `--config <path>` flag — explicit override, ignores all other files
2. Repo-local `.myctl.toml` (walked up from cwd)
3. User `~/.config/myctl/config.toml`
4. Schema defaults declared in `cli.config.ts` / `defineCommand`

---

## Overriding the config path

The built-in `--config` flag lets users point to any file:

```sh
myctl deploy --config ./ci-config.toml
```

When `--config` is provided, the user config and repo-local walk are both skipped — only the specified file is read.

---

## Keys without a schema declaration

You don't have to declare every key you use. `runtime.config` and `runtime.commandConfig` always contain the raw TOML values from the file, whether or not they appear in a schema. The schema only adds two things:

- **Defaults** — applied when the key is absent from all config files
- **Documentation** — a description field for future tooling (e.g. `myctl doctor`)

---

## Testing

Provide config values directly in `MockRuntime` — no files needed:

```ts
import { MockRuntime } from "cape/testing";

const runtime = new MockRuntime({
  config: {
    apiUrl: "https://api.example.com",
    defaultEnvironment: "staging",
  },
  commandConfig: {
    strategy: "rolling",
    timeout: 300,
  },
});

await deployCommand.run(args, runtime);
```
