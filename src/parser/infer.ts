import type { ArgSchema, ParsedArgs, CompletionSource, ConfigSchema, ConfigField } from "./types.ts";

/**
 * The shape of a single flag definition — mirrors ArgSchema flags entry
 * but kept explicit here so the inference types can reference it directly.
 */
export type FlagDef = {
  type: "boolean" | "string" | "number";
  alias?: string;
  required?: boolean;
  multiple?: boolean;
  default?: unknown;
  description?: string;
  complete?: CompletionSource;
  hideInSubcommandHelp?: boolean;
};

/** Maps "boolean" | "string" | "number" to their TypeScript types. */
type FlagBaseType<T extends "boolean" | "string" | "number"> =
  T extends "boolean" ? boolean :
  T extends "string"  ? string  :
  T extends "number"  ? number  :
  never;

/**
 * Infers the TypeScript type of a single parsed flag value.
 *
 * - multiple: true         → array
 * - boolean               → always boolean (defaults to false, never undefined)
 * - required: true         → never undefined
 * - default provided       → never undefined
 * - otherwise              → value | undefined
 */
type InferFlagValue<F extends FlagDef> =
  F["multiple"] extends true
    ? FlagBaseType<F["type"]>[]
    : F["type"] extends "boolean"
      ? boolean
      : F["required"] extends true
        ? FlagBaseType<F["type"]>
        : F extends { default: NonNullable<unknown> }
          ? FlagBaseType<F["type"]>
          : FlagBaseType<F["type"]> | undefined;

/** Infers the typed flags record from a flags schema object. */
type InferFlags<F extends Record<string, FlagDef>> = {
  [K in keyof F]: InferFlagValue<F[K]>;
};

/**
 * Infers a fully typed ParsedArgs from an ArgSchema.
 * Falls back to the untyped ParsedArgs if the flags shape can't be resolved.
 */
export type InferParsedArgs<S extends ArgSchema> =
  S["flags"] extends Record<string, FlagDef>
    ? { flags: InferFlags<S["flags"]>; positionals: string[]; passthrough: string[] }
    : ParsedArgs;

// ---------------------------------------------------------------------------
// Config inference
// ---------------------------------------------------------------------------

type ConfigBaseType<T extends "string" | "number" | "boolean"> =
  T extends "string"  ? string  :
  T extends "number"  ? number  :
  T extends "boolean" ? boolean :
  never;

/**
 * Infers the TypeScript type of a single config value.
 *
 * - default provided → value is always present (never undefined)
 * - no default       → value may be undefined (key absent from all config files)
 */
type InferConfigValue<F extends ConfigField> =
  F extends { default: NonNullable<unknown> }
    ? ConfigBaseType<F["type"]>
    : ConfigBaseType<F["type"]> | undefined;

/**
 * Infers a typed commandConfig record from a ConfigSchema.
 * When the schema is empty (no config declared), falls back to
 * Record<string, unknown> so untyped access still compiles.
 */
export type InferConfig<CC extends ConfigSchema> =
  [keyof CC] extends [never]
    ? Record<string, unknown>
    : { [K in keyof CC]: InferConfigValue<CC[K]> };
