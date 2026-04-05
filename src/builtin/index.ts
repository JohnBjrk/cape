import type { CommandDef } from "../cli.ts";
import type { ConfigSchema } from "../parser/types.ts";
import { createPluginCommand } from "./plugin.ts";

/**
 * Returns the built-in commands injected into every Cape-based CLI.
 * These have the lowest priority — static and plugin commands override by name.
 */
export function createBuiltinCommands(
  cliName: string,
  codePluginDirs: string[],
  version: string,
  configSchema: ConfigSchema,
): CommandDef[] {
  return [createPluginCommand(cliName, codePluginDirs, version, configSchema)];
}
