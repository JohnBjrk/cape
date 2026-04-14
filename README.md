# Cape — CLI Application Plugin Engine

> **Alpha release** — Cape is early and the API may change. Feedback welcome.

Cape is a TypeScript CLI framework for building distributable command-line tools. It handles everything from scaffolding and development to compiling a self-contained binary, generating an install script, and publishing a GitHub release — all from a single `cape` command.

---

## Install

```sh
curl -fsSL https://github.com/JohnBjrk/cape/releases/latest/download/install.sh | sh
```

Then add Cape to your PATH (the installer will print the exact line):

```sh
export PATH="$HOME/.cape/bin:$PATH"
```

Verify:

```sh
cape --version
```

---

## Quickstart

### 1. Create a new CLI

<!-- golden: quickstart/init.txt cmd -->
```sh
cape init --name my-tool --yes
```

<!-- golden: quickstart/init.txt output -->
```text
Scaffolding my-tool...
✓ Created my-tool/

Next steps:
  cd my-tool
  cape run --help            # run in dev mode
  cape command add           # add a new command
  cape build                 # compile to a standalone binary
```

This scaffolds a project with a `cli.config.ts`, a `main.ts` entry point, and a sample `hello` command.

### 2. Run in dev mode

<!-- golden: quickstart/run.txt cmd -->
```sh
cape run -- hello --name World
```

<!-- golden: quickstart/run.txt output -->
```text
Hello, World!
```

`cape run` passes everything after `--` to your CLI. No build step — Cape runs your TypeScript directly.

### 3. Add a command

<!-- golden: quickstart/command-add.txt cmd -->
```sh
cape command add --name greet --description "Greet someone"
```

<!-- golden: quickstart/command-add.txt output -->
```text
✓ Created commands/greet.ts

Add it to your CLI in main.ts:
  import { greetCommand } from "./commands/greet.ts";
  const cli = createCli(config, [..., greetCommand]);
```

This generates a scaffold in `commands/greet.ts`:

<!-- golden: quickstart/commands/greet.ts -->
```ts
import { defineCommand } from "../cli.config.ts";

export const greetCommand = defineCommand({
  name: "greet",
  description: "Greet someone",
  schema: {
    flags: {
      // TODO: add flags
      // example: { type: "string", alias: "e", required: true, description: "An example flag" },
    },
  },
  async run(args, runtime) {
    // TODO: implement greet
    runtime.print("Running greet...");
  },
});
```

Open it and fill in the logic — for example:

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

Register it in `main.ts`:

```ts
// main.ts
import { createCli } from "cape";
import config from "./cli.config.ts";
import { helloCommand } from "./commands/hello.ts";
import { greetCommand } from "./commands/greet.ts";

const cli = createCli(config, [helloCommand, greetCommand]);

await cli.run();
```

Try it:

```sh
cape run -- greet --name Alice
# Hello, Alice!

cape run -- greet --name Alice --loud
# HELLO, ALICE!
```

---

## Build and install locally

Compile to a self-contained binary:

```sh
cape build
```

This writes `dist/my-tool`. Install it to `~/.my-tool/bin/`:

```sh
cape install
```

Add the bin dir to your PATH and run it directly:

```sh
export PATH="$HOME/.my-tool/bin:$PATH"
my-tool greet --name Alice
```

---

## Publish a GitHub release

### Setup

1. Add `install` to your `cli.config.ts`:

```ts
export default defineConfig({
  name: "my-tool",
  displayName: "My Tool",
  version: "0.1.0",
  description: "A CLI built with Cape",
  config: globalConfig,
  install: { type: "github", repo: "your-org/my-tool" },
});
```

2. Make sure the [GitHub CLI](https://cli.github.com) is installed and authenticated:

```sh
gh auth login
```

### Build for all platforms

```sh
cape build --all-platforms
```

This produces compressed binaries for all four targets in `dist/`:

```
dist/my-tool-darwin-arm64.gz
dist/my-tool-darwin-x64.gz
dist/my-tool-linux-arm64.gz
dist/my-tool-linux-x64.gz
dist/install.sh
```

### Publish

```sh
cape publish
```

Cape will verify the binary version matches `cli.config.ts`, show a summary, ask for confirmation, then create the GitHub release with all assets.

```
  Name:    My Tool
  Version: 0.1.0
  Tag:     v0.1.0
  Assets:  5 files from dist/

Publish My Tool v0.1.0 to GitHub? › Yes
```

Once published, anyone can install your CLI with:

```sh
curl -fsSL https://github.com/your-org/my-tool/releases/latest/download/install.sh | sh
```

---

## Plugins

Plugins let you extend an installed CLI without touching its source repo. A plugin is a TypeScript command file paired with a small `.plugin.toml` manifest — drop it in the right directory and it appears automatically.

Say you've installed `my-tool` and want to add a `status` command for your own workflow.

### 1. Configure a plugin directory

Create a `.my-tool.toml` in the directory where you'll keep your plugins:

```toml
[my-tool]
pluginDirs = ["./plugins"]
```

### 2. Scaffold the plugin

```sh
my-tool plugin create
# ? Plugin name: status
# ? Description: Show deployment status
# ? Location: ./plugins/  (local)
```

This generates two files in `plugins/status/`:

```
plugins/status/status.plugin.toml
plugins/status/status.ts
```

It also creates a `.my-tool/` folder with typed helpers — commit this alongside your plugin.

### 3. Fill in the logic

Open `plugins/status/status.ts` and add your implementation:

```ts
import { defineCommand } from "../../.my-tool/index.ts";

export default defineCommand({
  name: "status",
  description: "Show deployment status",
  schema: {
    flags: {
      env: { type: "string", alias: "e", default: "staging", description: "Target environment" },
    },
  },
  async run(args, runtime) {
    runtime.print(`Checking status for ${args.flags.env}...`);
    // fetch from your API, print a table, etc.
  },
});
```

### 4. Run it

```sh
my-tool status
# Checking status for staging...

my-tool status --env production
# Checking status for production...
```

No registration, no build step, no PR to the `my-tool` repo.

---

## Project layout

```
my-tool/
  cli.config.ts       # CLI metadata, config schema, typed helpers
  main.ts             # Entry point — registers commands
  commands/           # Built-in commands
  plugins/            # Optional: plugin directories
  dist/               # Build output (git-ignored)
```

---

## Cape CLI reference

| Command | Description |
|---|---|
| `cape init <name>` | Scaffold a new Cape CLI project |
| `cape run -- [command] [args]` | Run commands in dev mode (no build) |
| `cape command add` | Generate a new command file |
| `cape build` | Compile to a standalone binary |
| `cape build --all-platforms` | Build for darwin/linux × arm64/x64 |
| `cape install` | Install the local binary to `~/.<name>/bin/` |
| `cape publish` | Create a GitHub release with dist/ assets |
| `cape publish --draft` | Create as draft (publish manually on GitHub) |

---

## License

MIT
