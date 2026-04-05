import type { ParsedArgs } from "../parser/types.ts";
import type { ArgSchema } from "../parser/types.ts";
import type { GlobalFlags } from "../parser/global-flags.ts";
import type { Runtime } from "./types.ts";
import { createOutput, createJsonOutput, type OutputInterface } from "./output.ts";
import { createFs, type FsInterface } from "./fs.ts";
import { createStdin, type StdinInterface } from "./stdin.ts";
import { createLog, type LogInterface } from "./log.ts";
import { createSignalManager, type SignalManager } from "./signal.ts";
import { createSecrets, type SecretsInterface } from "./secrets.ts";
import { loadConfig, type LoadConfigOptions } from "./config.ts";
import { text, select, confirm, multiSelect, autocomplete } from "../prompt/index.ts";
import { NonTtyError, PromptCancelledError, type PromptInterface } from "../prompt/types.ts";

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
  prompt: PromptInterface;

  private _signalManager: SignalManager;
  private _exitHandlers: Array<() => void | Promise<void>> = [];
  private _flushJson: (() => void) | undefined;

  constructor(opts: BasicRuntimeOptions) {
    this.args = opts.args;
    this.env  = isolateEnv(opts.rawEnv, opts.schema);

    const { globals, cliName, commandName } = opts;

    if (globals.json) {
      const jsonOut = createJsonOutput(globals.quiet);
      this.output       = jsonOut;
      this._flushJson   = () => jsonOut.flushJson();
    } else {
      this.output = createOutput({
        noColor: globals.noColor,
        quiet:   globals.quiet,
        isTTY:   !!process.stdout.isTTY,
      });
    }

    this.fs     = createFs(cliName);
    this.stdin  = createStdin();
    this.log    = createLog({ verbose: globals.verbose, debug: globals.debug, noColor: globals.noColor });
    this.secrets = createSecrets(cliName, commandName);

    this._signalManager = createSignalManager();
    this.signal = this._signalManager.signal;

    this.prompt = {
      text:         (opts) => text({ ...opts, signal: this.signal }),
      confirm:      (opts) => confirm({ ...opts, signal: this.signal }),
      select:       (opts) => select({ ...opts, signal: this.signal }),
      multiSelect:  (opts) => multiSelect({ ...opts, signal: this.signal }),
      autocomplete: (opts) => autocomplete({ ...opts, signal: this.signal }),
      NonTtyError,
      PromptCancelledError,
    };
  }

  /** Call after successful command.run() to emit buffered JSON (if --json). */
  flushOutput(): void {
    this._flushJson?.();
  }

  /** Call after the command finishes to remove signal listeners. */
  teardown(): void {
    this._signalManager.teardown();
  }

  /** Loads config.toml and populates this.config / this.commandConfig. */
  async loadConfig(cliName: string, commandSection: string, opts?: LoadConfigOptions): Promise<void> {
    const result = await loadConfig(cliName, commandSection, opts);
    this.config        = result.config;
    this.commandConfig = result.commandConfig;
  }

  print(text: string): void {
    this.output.print(text);
  }

  printError(text: string): void {
    this.output.printError(text);
  }

  exit(code: number): never {
    // Flush buffered JSON before exiting so commands that call runtime.exit()
    // explicitly (e.g. after a successful operation) still emit their output.
    this._flushJson?.();
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
