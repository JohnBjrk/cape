import { defineCommand } from "../../src/cli.ts";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { resolveName, refreshCapeModule } from "./helpers.ts";

export const runCommand = defineCommand({
  name: "run",
  description: "Run the CLI in the current directory (dev mode)",
  schema: {
    flags: {
      name: {
        type: "string",
        alias: "n",
        description: "CLI name (must match the name in cli.config.ts)",
      },
      "skip-refresh": {
        type: "boolean",
        description: "Skip refreshing node_modules/cape/ before running",
      },
    },
  },
  async run(args, runtime) {
    const cwd = process.cwd();
    const configPath = join(cwd, "cli.config.ts");

    if (!existsSync(configPath)) {
      runtime.printError("Error: no cli.config.ts found in the current directory.");
      runtime.printError("Run `cape init --name <name>` to create a new Cape project.");
      runtime.exit(1);
    }

    // Load config — verify name if provided, read entry point
    const { config } = await resolveName(configPath, args.flags.name as string | undefined, runtime);
    const entry = (config.entry as string | undefined) ?? "main.ts";

    const entryPath = resolve(cwd, entry);
    if (!existsSync(entryPath)) {
      runtime.printError(`Error: entry file not found: ${entryPath}`);
      runtime.printError(`Check that "entry" in cli.config.ts points to an existing file.`);
      runtime.exit(1);
    }

    // Refresh node_modules/cape/ so module resolution and types stay current
    if (!args.flags["skip-refresh"]) {
      await refreshCapeModule(cwd);
    }

    // Forward args: everything after `--`
    // Usage: cape run --name mycli -- hello --arg1 "Hello" --arg2 "World"
    const forwardedArgs = args.passthrough;

    runtime.log.debug(`Importing ${entryPath} with args: ${forwardedArgs.join(" ")}`);

    // The cape binary embeds the Bun runtime — use dynamic import() to run the
    // user's TypeScript directly without requiring bun in PATH.
    // Override process.argv so the user's `cli.run()` sees the right args.
    process.argv = [process.execPath, entryPath, ...forwardedArgs];
    await import(entryPath);
  },
});

