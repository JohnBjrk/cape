import { join } from "node:path";
import { parseToml } from "./toml.ts";
import { xdgConfigHome } from "./fs.ts";

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/**
 * Loads `~/.config/<cliName>/config.toml` (or `$XDG_CONFIG_HOME/<cliName>/config.toml`).
 *
 * Returns:
 *   config        — top-level TOML keys (the "" section)
 *   commandConfig — keys from the [commandName] section
 *
 * If the file does not exist both are empty objects.
 */
export async function loadConfig(
  cliName: string,
  commandName: string,
  overridePath?: string,
): Promise<{ config: Record<string, unknown>; commandConfig: Record<string, unknown> }> {
  const filePath = overridePath ?? join(xdgConfigHome(), cliName, "config.toml");
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return { config: {}, commandConfig: {} };
  }

  let doc: ReturnType<typeof parseToml>;
  try {
    doc = parseToml(await file.text());
  } catch {
    return { config: {}, commandConfig: {} };
  }

  return {
    config:        (doc[""] ?? {}) as Record<string, unknown>,
    commandConfig: (doc[commandName] ?? {}) as Record<string, unknown>,
  };
}
