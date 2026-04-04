import { join } from "node:path";
import { existsSync } from "node:fs";
import { parseToml, type TomlDocument } from "./toml.ts";
import { xdgConfigHome } from "./fs.ts";
import type { ConfigSchema } from "../parser/types.ts";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LoadConfigOptions {
  /** Override path from --config flag — skips user config and local walk. */
  overridePath?: string;
  /** Schema for top-level keys (from CliConfig.config). */
  cliSchema?: ConfigSchema;
  /** Schema for this command's section (from CommandDef.config). */
  commandSchema?: ConfigSchema;
}

/**
 * Loads and merges config files for the running command.
 *
 * Priority (highest → lowest):
 *   1. Repo-local `.{cliName}.toml` (walked up from cwd to git root)
 *   2. User `~/.config/{cliName}/config.toml`
 *   3. Schema defaults
 *
 * When --config is passed, only that file is read (no walk, no user file).
 *
 * @param cliName        CLI name (used for file paths and section lookup).
 * @param commandSection TOML section name for commandConfig — always the
 *                       parent command name so subcommands share one section.
 */
export async function loadConfig(
  cliName: string,
  commandSection: string,
  options?: LoadConfigOptions,
): Promise<{ config: Record<string, unknown>; commandConfig: Record<string, unknown> }> {
  let merged: TomlDocument;

  if (options?.overridePath) {
    // --config path: use only that file
    merged = await readTomlFile(options.overridePath);
  } else {
    const userPath = join(xdgConfigHome(), cliName, "config.toml");
    const [userDoc, localDoc] = await Promise.all([
      readTomlFile(userPath),
      findLocalConfig(cliName),
    ]);
    // Local overrides user, per section
    merged = mergeDocuments(userDoc, localDoc);
  }

  const rawConfig        = (merged[""] ?? {}) as Record<string, unknown>;
  const rawCommandConfig = (merged[commandSection] ?? {}) as Record<string, unknown>;

  return {
    config:        applyDefaults(rawConfig,        options?.cliSchema),
    commandConfig: applyDefaults(rawCommandConfig, options?.commandSchema),
  };
}

// ---------------------------------------------------------------------------
// Local config walk
// ---------------------------------------------------------------------------

/**
 * Searches for `.{cliName}.toml` starting from `process.cwd()` and walking up.
 * Stops at the git root (directory containing `.git`) or the filesystem root.
 * Returns an empty document if no file is found.
 */
async function findLocalConfig(cliName: string): Promise<TomlDocument> {
  const filename = `.${cliName}.toml`;
  let dir = process.cwd();

  while (true) {
    const candidate = join(dir, filename);
    if (existsSync(candidate)) {
      return readTomlFile(candidate);
    }
    // Stop at git root
    if (existsSync(join(dir, ".git"))) break;
    const parent = join(dir, "..");
    if (parent === dir) break; // filesystem root
    dir = parent;
  }

  return { "": {} };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readTomlFile(path: string): Promise<TomlDocument> {
  const file = Bun.file(path);
  if (!(await file.exists())) return { "": {} };
  try {
    return parseToml(await file.text());
  } catch {
    return { "": {} };
  }
}

/**
 * Merges two TOML documents. `override` wins on a per-key basis within each
 * section — sections present only in `base` are preserved untouched.
 */
function mergeDocuments(base: TomlDocument, override: TomlDocument): TomlDocument {
  const result: TomlDocument = { ...base };
  for (const [section, entries] of Object.entries(override)) {
    result[section] = { ...(base[section] ?? {}), ...entries };
  }
  return result;
}

/**
 * Applies schema defaults and isolates config to declared keys.
 *
 * When a schema is provided:
 *   - Only keys declared in the schema are returned (undeclared TOML keys are dropped).
 *   - Missing keys receive their schema default if one is defined.
 *
 * When no schema is provided, all values pass through unchanged (e.g. top-level
 * CliConfig.config is not declared → every command can read all top-level keys).
 */
function applyDefaults(
  values: Record<string, unknown>,
  schema: ConfigSchema | undefined,
): Record<string, unknown> {
  if (!schema) return values;
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema)) {
    result[key] = values[key] !== undefined ? values[key] : field.default;
  }
  return result;
}
