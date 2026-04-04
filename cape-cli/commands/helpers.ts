import type { Runtime } from "../../src/runtime/types.ts";

/**
 * Load the CLI name from cli.config.ts, verify it against the --name flag
 * if provided, and return it. Calls runtime.exit(1) on any error.
 */
export async function resolveName(
  configPath: string,
  expectedName: string | undefined,
  runtime: Runtime,
): Promise<string> {
  let cliName: string;
  try {
    const mod = await import(configPath) as { default?: { name?: string } };
    if (!mod.default?.name) throw new Error("missing name in cli.config.ts");
    cliName = mod.default.name;
  } catch (err) {
    runtime.printError(`Error: could not load cli.config.ts: ${err instanceof Error ? err.message : err}`);
    runtime.exit(1);
  }

  if (expectedName && expectedName !== cliName!) {
    runtime.printError(`Error: --name "${expectedName}" does not match the CLI name "${cliName!}" in cli.config.ts.`);
    runtime.exit(1);
  }

  return cliName!;
}
