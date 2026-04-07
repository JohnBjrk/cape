import type { CliConfig } from "../cli.ts";
import type { ConfigSchema } from "../parser/types.ts";

/**
 * The full configuration for a Cape-based CLI.
 *
 * Used in `cli.config.ts` in the project root. Pass it directly to
 * `createCli()` — the extra build-only fields (`entry`, `outfile`) are
 * silently ignored at runtime.
 */
export interface CliConfigDef extends CliConfig {
  /**
   * Semantic version string. Required — enables `--version` support.
   * E.g. "1.2.3"
   */
  version: string;

  /**
   * Entry point file for `bun build --compile`.
   * Default: "./main.ts" (resolved relative to cli.config.ts).
   */
  entry?: string;

  /**
   * Output binary filename. Default: `name`.
   */
  outfile?: string;
}

/**
 * Defines a CLI configuration with full TypeScript type checking.
 * Place this in `cli.config.ts` at your project root.
 *
 * @example
 * ```ts
 * // cli.config.ts
 * import { defineConfig } from "cape";
 *
 * export default defineConfig({
 *   name: "myctl",
 *   displayName: "My Control",
 *   version: "1.0.0",
 *   description: "Manage your infrastructure",
 * });
 * ```
 */
export function defineConfig<T extends CliConfigDef>(config: T): T {
  return config;
}

/**
 * Defines a config schema with preserved literal types — no `as const` needed.
 * Use this to declare the `globalConfig` in `cli.config.ts`.
 *
 * @example
 * ```ts
 * const globalConfig = defineConfigSchema({
 *   apiUrl: { type: "string", description: "Base API URL" },
 *   retries: { type: "number", default: 3 },
 *   tags:    { type: "array", items: { type: "string" } },
 * });
 * export const { defineCommand } = typedWith<typeof globalConfig>();
 * ```
 */
export function defineConfigSchema<S extends ConfigSchema>(schema: S): S {
  return schema;
}

/**
 * Defines a per-command config schema with preserved literal types — no `as const` needed.
 * Use this to declare command-level config inline or in a variable.
 *
 * @example
 * ```ts
 * const commandConfig = defineCommandConfig({
 *   alwaysYes: { type: "boolean", default: false },
 * });
 *
 * export const myCommand = defineCommand({
 *   name: "my-command",
 *   config: commandConfig,
 *   async run(_args, runtime) {
 *     if (runtime.commandConfig.alwaysYes) { ... }
 *   },
 * });
 * ```
 */
export function defineCommandConfig<S extends ConfigSchema>(schema: S): S {
  return schema;
}
