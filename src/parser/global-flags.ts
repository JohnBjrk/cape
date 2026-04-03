import type { ArgSchema, ParsedArgs } from "./types.ts";

/** The framework's built-in flags, available on every command. */
export const globalSchema: ArgSchema = {
  flags: {
    help:       { type: "boolean", alias: "h", description: "Show help" },
    version:    { type: "boolean",              description: "Show version" },
    json:       { type: "boolean",              description: "Output as JSON" },
    "no-color": { type: "boolean",              description: "Disable ANSI color and formatting" },
    quiet:      { type: "boolean", alias: "q",  description: "Suppress all output except errors" },
    verbose:    { type: "boolean", alias: "v",  description: "Enable verbose log output" },
    debug:      { type: "boolean",              description: "Enable debug log output (superset of --verbose)" },
    config:     { type: "string",               description: "Override config file location" },
  },
};

export interface GlobalFlags {
  help: boolean;
  version: boolean;
  json: boolean;
  noColor: boolean;
  quiet: boolean;
  verbose: boolean;
  debug: boolean;
  config: string | undefined;
}

/**
 * Merges two schemas. `overlay` wins on flag name collision (command flags
 * shadow global flags). Positionals come from `overlay` only — global flags
 * never declare positionals.
 */
export function mergeSchemas(base: ArgSchema, overlay: ArgSchema): ArgSchema {
  return {
    flags: { ...base.flags, ...overlay.flags },
    positionals: overlay.positionals,
  };
}

/**
 * Extracts typed global flag values from a parsed args object.
 * If `--debug` is set, `verbose` is also considered active.
 */
export function extractGlobalFlags(parsed: ParsedArgs): GlobalFlags {
  const f = parsed.flags;
  const debug = Boolean(f["debug"]);
  return {
    help:    Boolean(f["help"]),
    version: Boolean(f["version"]),
    json:    Boolean(f["json"]),
    noColor: Boolean(f["no-color"]),
    quiet:   Boolean(f["quiet"]),
    verbose: debug || Boolean(f["verbose"]),  // --debug implies --verbose
    debug,
    config:  f["config"] as string | undefined,
  };
}
