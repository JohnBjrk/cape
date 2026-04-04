import { defineCommand } from "../../src/cli.ts";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { CAPE_BUNDLE, CAPE_TYPES } from "../src/embedded.ts";

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
    let entry = "main.ts";
    try {
      const mod = await import(configPath) as { default?: { name?: string; entry?: string } };
      const cfg = mod.default;
      const expectedName = args.flags.name as string | undefined;
      if (expectedName && cfg?.name && cfg.name !== expectedName) {
        runtime.printError(`Error: --name "${expectedName}" does not match the CLI name "${cfg.name}" in cli.config.ts.`);
        runtime.exit(1);
      }
      entry = cfg?.entry ?? "main.ts";
    } catch {
      // Fall back to defaults if config can't be loaded
    }

    const entryPath = resolve(cwd, entry);
    if (!existsSync(entryPath)) {
      runtime.printError(`Error: entry file not found: ${entryPath}`);
      runtime.printError(`Check that "entry" in cli.config.ts points to an existing file.`);
      runtime.exit(1);
    }

    // Refresh node_modules/cape/ so module resolution and types stay current
    if (!args.flags["skip-refresh"] && CAPE_BUNDLE) {
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

async function refreshCapeModule(cwd: string): Promise<void> {
  const capeModDir = join(cwd, "node_modules", "cape");
  await mkdir(capeModDir, { recursive: true });
  await Promise.all([
    Bun.write(
      join(capeModDir, "package.json"),
      JSON.stringify(
        { name: "cape", version: "0.1.0", type: "module", main: "index.js", types: "index.d.ts" },
        null,
        2,
      ) + "\n",
    ),
    Bun.write(join(capeModDir, "index.js"),   CAPE_BUNDLE),
    Bun.write(join(capeModDir, "index.d.ts"), CAPE_TYPES),
  ]);
}
