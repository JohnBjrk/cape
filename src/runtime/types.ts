import type { ParsedArgs } from "../parser/types.ts";
import type { OutputInterface } from "./output.ts";
import type { FsInterface } from "./fs.ts";
import type { StdinInterface } from "./stdin.ts";
import type { LogInterface } from "./log.ts";
import type { SecretsInterface } from "./secrets.ts";
import type { PromptInterface } from "../prompt/types.ts";

export interface Runtime {
  // ---------------------------------------------------------------------------
  // Core (backwards-compatible)
  // ---------------------------------------------------------------------------

  /** Parsed args for the current command invocation. */
  args: ParsedArgs;

  /**
   * Environment variables available to this command.
   * When the command schema declares `env: ["FOO", "BAR"]`, only those
   * variables are exposed.  Otherwise all env vars pass through.
   */
  env: Record<string, string>;

  /** Write a line to stdout. */
  print(text: string): void;
  /** Write a line to stderr. */
  printError(text: string): void;
  /** Exit the process with the given exit code. */
  exit(code: number): never;

  // ---------------------------------------------------------------------------
  // Phase 3 additions
  // ---------------------------------------------------------------------------

  /** Rich output interface — table, list, json, success, warn, spinner, progress. */
  output: OutputInterface;

  /** Filesystem helpers with XDG path utilities. */
  fs: FsInterface;

  /** Stdin access — isTTY check, read, line iteration. */
  stdin: StdinInterface;

  /** Verbose / debug logging wired to --verbose / --debug global flags. */
  log: LogInterface;

  /**
   * AbortSignal that is aborted when SIGINT or SIGTERM is received.
   * Pass this to fetch(), long-running loops, or async operations so they
   * can cancel cleanly.
   */
  signal: AbortSignal;

  /**
   * Register a cleanup function that runs when the process receives SIGINT or
   * SIGTERM.  Handlers run in reverse registration order (last-in, first-out).
   */
  onExit(fn: () => void | Promise<void>): void;

  /** Secrets interface — get/set/delete values from credentials.toml. */
  secrets: SecretsInterface;

  /** Top-level config from `~/.config/<cli>/config.toml`. */
  config: Record<string, unknown>;

  /** Command-specific section from config.toml (`[command-name]`). */
  commandConfig: Record<string, unknown>;

  /**
   * Interactive prompt helpers — pre-bound to this command's AbortSignal.
   * No separate imports needed; use `runtime.prompt.text(...)` etc.
   */
  prompt: PromptInterface;
}
