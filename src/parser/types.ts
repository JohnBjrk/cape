// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

/**
 * Config schema declared on a `CliConfig` (top-level keys) or a `CommandDef`
 * (command-scoped section).  Keys map to their field definitions.
 */
export type ConfigSchema = Record<string, ConfigField>;

/** A scalar (string / number / boolean) config field. */
export interface ConfigScalarField {
  type: "string" | "number" | "boolean";
  description?: string;
  default?: string | number | boolean;
}

/** An array config field whose items are described by a nested ConfigField. */
export interface ConfigArrayField {
  type: "array";
  /** Schema for each element — any ConfigField variant, including object. */
  items: ConfigField;
  description?: string;
  default?: unknown[];
}

/** A nested-object config field whose sub-keys are declared in `fields`. */
export interface ConfigObjectField {
  type: "object";
  description?: string;
  fields: ConfigSchema;
}

/**
 * A single config file key — a scalar value, an array, or a nested object.
 * Discriminated on `type`.
 */
export type ConfigField = ConfigScalarField | ConfigArrayField | ConfigObjectField;

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

/** Context passed to dynamic completion fetchers. */
export interface CompletionCtx {
  /** The partial word being completed. */
  partial: string;
  /** Flag values already typed on the command line (best-effort, may be incomplete). */
  flags: Record<string, unknown>;
}

export type CompletionSource =
  | { type: "static"; values: string[] }
  | {
      type: "dynamic";
      fetch: (ctx: CompletionCtx) => Promise<string[]>;
      /** How long to cache results (ms). Omit to disable caching. */
      cacheMs?: number;
      /** Abort and return [] if fetch takes longer than this (ms). Default: 5000. */
      timeoutMs?: number;
      /** Other flag names whose values should be available in ctx.flags before fetching. */
      dependsOn?: string[];
    };

export interface ArgSchema {
  positionals?: {
    name: string;
    variadic?: boolean;
    complete?: CompletionSource;
  }[];
  flags?: {
    [name: string]: {
      type: "boolean" | "string" | "number";
      alias?: string;
      required?: boolean;
      multiple?: boolean;
      default?: unknown;
      description?: string;
      complete?: CompletionSource;
      hideInSubcommandHelp?: boolean;
    };
  };
  /**
   * Environment variable names to expose on `runtime.env`.
   * When declared, only these variables are visible to the command.
   * When omitted, all environment variables are passed through.
   */
  env?: string[];
}

export interface ParsedArgs {
  flags: Record<string, unknown>;
  positionals: string[];
  passthrough: string[]; // tokens after --
  /** Flag names that were explicitly set by the user (excludes defaults). */
  provided: Set<string>;
}

export type TokenType = "flag" | "value" | "separator";

export interface Token {
  type: TokenType;
  raw: string;
}
