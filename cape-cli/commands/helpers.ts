import type { Runtime } from "../../src/runtime/types.ts";

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
