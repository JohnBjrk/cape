import { defineCommand } from "../../src/cli.ts";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { CAPE_BUNDLE, CAPE_TYPES } from "../src/embedded.ts";

export const runCommand = defineCommand({
  name: "run",
  description: "Run the CLI in the current directory (dev mode — requires bun in PATH)",
  schema: {
    flags: {
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
      runtime.printError("Run `cape init <name>` to create a new Cape project.");
      runtime.exit(1);
    }

    // Load config to find the entry point
    let entry = "main.ts";
    try {
      const mod = await import(configPath) as { default?: { entry?: string } };
      entry = mod.default?.entry ?? "main.ts";
    } catch {
      // Fall back to default
    }

    const entryPath = resolve(cwd, entry);
    if (!existsSync(entryPath)) {
      runtime.printError(`Error: entry file not found: ${entryPath}`);
      runtime.printError(`Check that "entry" in cli.config.ts points to an existing file.`);
      runtime.exit(1);
    }

    // Refresh node_modules/cape/ so the runtime is up to date
    if (!args.flags["skip-refresh"] && CAPE_BUNDLE) {
      await refreshCapeModule(cwd);
    }

    // Collect forwarded args from passthrough (after --)
    // Usage: cape run -- hello --name Alice
    const forwardedArgs = args.passthrough;

    runtime.log.debug(`Running: bun run ${entryPath} ${forwardedArgs.join(" ")}`);

    const proc = Bun.spawnSync(
      ["bun", "run", entryPath, ...forwardedArgs],
      { cwd, stdout: "inherit", stderr: "inherit", stdin: "inherit" },
    );

    process.exit(proc.exitCode ?? 0);
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
    Bun.write(join(capeModDir, "index.js"),    CAPE_BUNDLE),
    Bun.write(join(capeModDir, "index.d.ts"),  CAPE_TYPES),
  ]);
}
