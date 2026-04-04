import type { CliConfig } from "../cli.ts";

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
