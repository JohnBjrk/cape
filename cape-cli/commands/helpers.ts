import type { Runtime } from "../../src/runtime/types.ts";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { CAPE_BUNDLE, CAPE_TYPES } from "../src/embedded.ts";

/**
 * Load the CLI config from cli.config.ts, verify the name against the
 * --name flag if provided, and return the raw config object.
 * Calls runtime.exit(1) on any error.
 */
export async function resolveName(
  configPath: string,
  expectedName: string | undefined,
  runtime: Runtime,
): Promise<{ name: string; config: Record<string, unknown> }> {
  let config: Record<string, unknown>;
  try {
    const mod = await import(configPath) as { default?: Record<string, unknown> };
    if (!mod.default?.name) throw new Error("missing name in cli.config.ts");
    config = mod.default;
  } catch (err) {
    runtime.printError(`Error: could not load cli.config.ts: ${err instanceof Error ? err.message : err}`);
    runtime.exit(1);
  }

  const cliName = config!.name as string;

  if (expectedName && expectedName !== cliName) {
    runtime.printError(`Error: --name "${expectedName}" does not match the CLI name "${cliName}" in cli.config.ts.`);
    runtime.exit(1);
  }

  return { name: cliName, config: config! };
}

/**
 * Write the bundled cape runtime and type declarations into
 * `<cwd>/node_modules/cape/` so the project can import from "cape".
 */
export async function refreshCapeModule(cwd: string): Promise<void> {
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
