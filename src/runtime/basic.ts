import type { ParsedArgs } from "../parser/types.ts";
import type { ArgSchema } from "../parser/types.ts";
import type { GlobalFlags } from "../parser/global-flags.ts";
import type { Runtime } from "./types.ts";
import { createOutput, type OutputInterface } from "./output.ts";
import { createFs, type FsInterface } from "./fs.ts";
import { createStdin, type StdinInterface } from "./stdin.ts";
import { createLog, type LogInterface } from "./log.ts";
import { createSignalManager, type SignalManager } from "./signal.ts";
import { createSecrets, type SecretsInterface } from "./secrets.ts";
import { loadConfig } from "./config.ts";

export interface BasicRuntimeOptions {
  args: ParsedArgs;
  rawEnv: Record<string, string>;
  globals: GlobalFlags;
  cliName: string;
  commandName: string;
  /** The merged schema for the running command (used for env var isolation). */
  schema?: ArgSchema;
}

/**
 * The real runtime used when a command is actually executed.
 * All interfaces delegate to process.stdout / stderr / stdin / filesystem.
 */
export class BasicRuntime implements Runtime {
  args: ParsedArgs;
  env: Record<string, string>;
  output: OutputInterface;
  fs: FsInterface;
  stdin: StdinInterface;
  log: LogInterface;
  signal: AbortSignal;
  secrets: SecretsInterface;
  config: Record<string, unknown> = {};
  commandConfig: Record<string, unknown> = {};

  private _signalManager: SignalManager;
  private _exitHandlers: Array<() => void | Promise<void>> = [];

  constructor(opts: BasicRuntimeOptions) {
    this.args = opts.args;
    this.env  = isolateEnv(opts.rawEnv, opts.schema);

    const { globals, cliName, commandName } = opts;

    this.output = createOutput({
      noColor: globals.noColor,
      quiet:   globals.quiet,
      isTTY:   !!process.stdout.isTTY,
    });

    this.fs     = createFs(cliName);
    this.stdin  = createStdin();
    this.log    = createLog({ verbose: globals.verbose, debug: globals.debug, noColor: globals.noColor });
    this.secrets = createSecrets(cliName, commandName);

    this._signalManager = createSignalManager();
    this.signal = this._signalManager.signal;
  }

  /** Call after the command finishes to remove signal listeners. */
  teardown(): void {
    this._signalManager.teardown();
  }

  /** Loads config.toml and populates this.config / this.commandConfig. */
  async loadConfig(cliName: string, commandName: string): Promise<void> {
    const result = await loadConfig(cliName, commandName);
    this.config        = result.config;
    this.commandConfig = result.commandConfig;
  }

  print(text: string): void {
    process.stdout.write(text + "\n");
  }

  printError(text: string): void {
    process.stderr.write(text + "\n");
  }

  exit(code: number): never {
    process.exit(code);
  }

  onExit(fn: () => void | Promise<void>): void {
    this._signalManager.onExit(fn);
  }
}

// ---------------------------------------------------------------------------
// Env var isolation
// ---------------------------------------------------------------------------

/**
 * If the schema declares `env: ["FOO", "BAR"]`, only expose those variables.
 * If no `env` field is declared, expose all environment variables.
 */
function isolateEnv(
  rawEnv: Record<string, string>,
  schema: ArgSchema | undefined,
): Record<string, string> {
  const declared = (schema as { env?: string[] } | undefined)?.env;
  if (!declared) return rawEnv;
  const result: Record<string, string> = {};
  for (const key of declared) {
    if (rawEnv[key] !== undefined) result[key] = rawEnv[key]!;
  }
  return result;
}
