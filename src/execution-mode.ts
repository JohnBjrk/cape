export type ExecutionMode = "run" | "complete";

/**
 * The mode the framework set before importing this plugin module.
 * Plugin authors can read this at module level to skip expensive imports
 * that are only needed during execution (not completion).
 *
 * @example
 * import { executionMode } from "cape";
 * const client = executionMode === "run" ? await import("./heavy-sdk.ts") : null;
 */
export const executionMode: ExecutionMode =
  ((globalThis as Record<string, unknown>)["__CAPE_EXECUTION_MODE__"] as ExecutionMode) ?? "run";
