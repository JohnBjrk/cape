import { join, isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import { parseToml, type TomlDocument } from "./toml.ts";
import { xdgConfigHome, expandHome } from "./fs.ts";
import type { ConfigSchema, ConfigField } from "../parser/types.ts";

// ---------------------------------------------------------------------------
// Framework config (early read — before per-command dispatch)
// ---------------------------------------------------------------------------

/**
 * Returns the directory containing the repo-local `.{cliName}.toml` config
 * file, found by walking up from cwd to the git root. Returns null if not found.
 */
export async function findLocalConfigDir(cliName: string): Promise<string | null> {
  const filename = `.${cliName}.toml`;
  let dir = process.cwd();
  while (true) {
    if (existsSync(join(dir, filename))) return dir;
    if (existsSync(join(dir, ".git"))) break;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Reads the framework-reserved `[cliName]` section from the merged config
 * files. Used at CLI startup for framework-level settings (e.g. pluginDirs).
 * The section is always stripped from runtime.config so it never leaks to commands.
 */
export async function readFrameworkConfig(cliName: string): Promise<Record<string, unknown>> {
  const userConfigDir = join(xdgConfigHome(), cliName);
  const localConfigDir = await findLocalConfigDir(cliName);

  const [userDoc, localDoc] = await Promise.all([
    readTomlFile(join(userConfigDir, "config.toml")),
    localConfigDir
      ? readTomlFile(join(localConfigDir, `.${cliName}.toml`))
      : Promise.resolve({} as TomlDocument),
  ]);

  // Resolve pluginDirs to absolute paths relative to each config file's directory,
  // so that relative entries like "plugins" work from any cwd (including compiled binaries).
  resolveFrameworkPluginDirs(userDoc, cliName, userConfigDir);
  if (localConfigDir) resolveFrameworkPluginDirs(localDoc, cliName, localConfigDir);

  const merged = mergeDocuments(userDoc, localDoc);
  return (merged[cliName] as Record<string, unknown>) ?? {};
}

function resolveFrameworkPluginDirs(doc: TomlDocument, cliName: string, baseDir: string): void {
  const section = doc[cliName];
  if (!isPlainObject(section)) return;
  const dirs = section["pluginDirs"];
  if (!Array.isArray(dirs)) return;
  section["pluginDirs"] = (dirs as unknown[]).map((d) => {
    if (typeof d !== "string") return d;
    const expanded = expandHome(d);
    return isAbsolute(expanded) ? expanded : join(baseDir, expanded);
  });
}

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

  // Strip the framework-reserved [cliName] section — never exposed to commands.
  const { [cliName]: _framework, ...rawConfig } = merged;
  const rawCommandConfig = (merged[commandSection] as Record<string, unknown>) ?? {};

  const config        = applyDefaults(rawConfig,        options?.cliSchema);
  const commandConfig = applyDefaults(rawCommandConfig, options?.commandSchema);

  const errors = [
    ...(options?.cliSchema     ? validateConfig(config,        options.cliSchema)     : []),
    ...(options?.commandSchema ? validateConfig(commandConfig, options.commandSchema)  : []),
  ];
  if (errors.length > 0) throw new ConfigValidationError(errors);

  return { config, commandConfig };
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
  const dir = await findLocalConfigDir(cliName);
  if (!dir) return {};
  return readTomlFile(join(dir, `.${cliName}.toml`));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readTomlFile(path: string): Promise<TomlDocument> {
  const file = Bun.file(path);
  if (!(await file.exists())) return {};
  try {
    return parseToml(await file.text());
  } catch {
    return {};
  }
}

/**
 * Merges two TOML documents. `override` wins on a per-key basis.
 * Plain-object values (section tables) are shallow-merged so that keys
 * present only in `base` are preserved.
 */
function mergeDocuments(base: TomlDocument, override: TomlDocument): TomlDocument {
  const result: TomlDocument = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = result[key];
    if (isPlainObject(value) && isPlainObject(baseValue)) {
      result[key] = { ...baseValue, ...value };
    } else {
      result[key] = value;
    }
  }
  return result;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class ConfigValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Config validation failed:\n${errors.map((e) => `  ${e}`).join("\n")}`);
    this.name = "ConfigValidationError";
  }
}

function validateConfig(
  values: Record<string, unknown>,
  schema: ConfigSchema,
  path = "",
): string[] {
  const errors: string[] = [];
  for (const [key, field] of Object.entries(schema)) {
    const value = values[key];
    if (value === undefined) continue;
    const keyPath = path ? `${path}.${key}` : key;
    errors.push(...validateField(keyPath, value, field));
  }
  return errors;
}

function validateField(path: string, value: unknown, field: ConfigField): string[] {
  if (field.type === "object") {
    if (!isPlainObject(value)) return [`${path}: expected object, got ${typeLabel(value)}`];
    return validateConfig(value as Record<string, unknown>, field.fields, path);
  }
  if (field.type === "array") {
    if (!Array.isArray(value)) return [`${path}: expected array, got ${typeLabel(value)}`];
    return value.flatMap((item, i) => validateField(`${path}[${i}]`, item, field.items));
  }
  if (typeof value !== field.type) {
    return [`${path}: expected ${field.type}, got ${typeLabel(value)}`];
  }
  return [];
}

function typeLabel(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/**
 * Applies schema defaults and isolates config to declared keys.
 *
 * When a schema is provided:
 *   - Only keys declared in the schema are returned (undeclared TOML keys are dropped).
 *   - Missing scalar keys receive their schema default if one is defined.
 *   - Object keys recurse into their `fields` schema (always present, never undefined).
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
    if (field.type === "object") {
      const nested = (values[key] as Record<string, unknown> | undefined) ?? {};
      result[key] = applyDefaults(nested, field.fields);
    } else if (field.type === "array") {
      result[key] = values[key] !== undefined ? values[key] : (field.default ?? []);
    } else {
      result[key] = values[key] !== undefined ? values[key] : field.default;
    }
  }
  return result;
}
