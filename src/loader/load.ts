import { join, isAbsolute } from "node:path";
import type { DiscoveredPlugin } from "./types.ts";
import type { CommandDef } from "../cli.ts";
import type { ExecutionMode } from "../execution-mode.ts";

/** The framework's own version — used for plugin compatibility checks. */
export const FRAMEWORK_VERSION = "1.0.0";

/**
 * Dynamically imports a plugin module and returns its CommandDef.
 * Sets the global execution mode before import so plugins can read it
 * at module level to skip expensive dependencies during completion.
 *
 * Throws if the plugin is incompatible (major version mismatch) or if
 * the module has no default export.
 */
export async function loadPlugin(
  plugin: DiscoveredPlugin,
  mode: ExecutionMode,
): Promise<CommandDef> {
  checkCompatibility(plugin);

  const absPath = resolveCommandPath(plugin);

  (globalThis as Record<string, unknown>)["__CAPE_EXECUTION_MODE__"] = mode;
  let mod: Record<string, unknown>;
  try {
    mod = await import(absPath);
  } finally {
    // Always clear the mode flag after import, even if the import fails
    (globalThis as Record<string, unknown>)["__CAPE_EXECUTION_MODE__"] = undefined;
  }

  const exported = mod["default"] ?? mod["command"];
  if (!exported || typeof exported !== "object") {
    throw new Error(
      `Plugin "${plugin.manifest.name}" at ${absPath} has no default export. ` +
        `Export a CommandDef as the default export.`,
    );
  }

  return exported as CommandDef;
}

/**
 * Checks framework version compatibility.
 * Major version mismatch → throws (hard error).
 * Minor/patch difference → no action here; the doctor command warns.
 */
function checkCompatibility(plugin: DiscoveredPlugin): void {
  const pluginMajor = parseMajor(plugin.manifest.frameworkVersion);
  const frameworkMajor = parseMajor(FRAMEWORK_VERSION);

  if (pluginMajor === null) {
    throw new Error(
      `Plugin "${plugin.manifest.name}" has an invalid frameworkVersion: ` +
        `"${plugin.manifest.frameworkVersion}". Expected semver format (e.g. "1.0.0").`,
    );
  }

  if (pluginMajor !== frameworkMajor) {
    throw new Error(
      `Plugin "${plugin.manifest.name}" requires framework v${pluginMajor}.x ` +
        `but this binary uses v${FRAMEWORK_VERSION}. ` +
        `Rebuild the plugin against the current framework version.`,
    );
  }
}

function parseMajor(version: string): number | null {
  const major = parseInt(version.split(".")[0] ?? "", 10);
  return Number.isNaN(major) ? null : major;
}

function resolveCommandPath(plugin: DiscoveredPlugin): string {
  const { command } = plugin.manifest;
  return isAbsolute(command) ? command : join(plugin.pluginDir, command);
}
