/**
 * Cape — CLI Application Plugin Engine
 * Public API type declarations.
 *
 * This file is generated into user projects at node_modules/cape/index.d.ts
 * by `cape init`. Do not edit the copy inside your project — run `cape run`
 * or `cape build` to refresh it from the installed cape binary.
 */

// ---------------------------------------------------------------------------
// Arg schema & parsed args
// ---------------------------------------------------------------------------

export interface CompletionCtx {
  partial: string;
  flags: Record<string, unknown>;
}

export type CompletionSource =
  | { type: "static"; values: string[] }
  | {
      type: "dynamic";
      fetch: (ctx: CompletionCtx) => Promise<string[]>;
      cacheMs?: number;
      timeoutMs?: number;
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
   * Env var names exposed on `runtime.env`.
   * When declared only these variables are visible; omit to pass all through.
   */
  env?: string[];
}

export interface ParsedArgs {
  flags: Record<string, unknown>;
  positionals: string[];
  passthrough: string[];
  provided: Set<string>;
}

// ---------------------------------------------------------------------------
// Runtime interfaces
// ---------------------------------------------------------------------------

export interface TableOptions {
  columns?: string[];
}

export interface Spinner {
  update(message: string): void;
  succeed(message?: string): void;
  fail(message?: string): void;
  stop(): void;
}

export interface ProgressBar {
  tick(n?: number): void;
  setTotal(total: number): void;
  done(message?: string): void;
}

export interface OutputInterface {
  print(text: string): void;
  printError(text: string): void;
  success(message: string): void;
  warn(message: string): void;
  json(value: unknown): void;
  table(rows: Record<string, unknown>[], opts?: TableOptions): void;
  list(items: string[]): void;
  spinner(message: string): Spinner;
  withSpinner<T>(message: string, fn: (spinner: Spinner) => Promise<T>): Promise<T>;
  progressBar(total: number): ProgressBar;
  withProgressBar<T>(total: number, fn: (bar: ProgressBar) => Promise<T>): Promise<T>;
}

export interface FsInterface {
  read(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  write(path: string, content: string | Uint8Array, mode?: number): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<string[]>;
  configPath(...segments: string[]): string;
  dataPath(...segments: string[]): string;
  cachePath(...segments: string[]): string;
}

export interface StdinInterface {
  readonly isTTY: boolean;
  read(): Promise<string>;
  lines(): AsyncIterable<string>;
}

export interface LogInterface {
  verbose(message: string): void;
  debug(message: string): void;
}

export interface SecretsInterface {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Runtime {
  args: ParsedArgs;
  env: Record<string, string>;
  print(text: string): void;
  printError(text: string): void;
  exit(code: number): never;
  output: OutputInterface;
  fs: FsInterface;
  stdin: StdinInterface;
  log: LogInterface;
  signal: AbortSignal;
  onExit(fn: () => void | Promise<void>): void;
  secrets: SecretsInterface;
  config: Record<string, unknown>;
  commandConfig: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

export interface SubcommandDef {
  name: string;
  aliases?: string[];
  description: string;
  schema?: ArgSchema;
  run(args: ParsedArgs, runtime: Runtime): Promise<void>;
}

export interface CommandDef {
  name: string;
  aliases?: string[];
  description: string;
  schema?: ArgSchema;
  subcommands?: SubcommandDef[];
  run?(args: ParsedArgs, runtime: Runtime): Promise<void>;
}

// ---------------------------------------------------------------------------
// CLI configuration
// ---------------------------------------------------------------------------

export interface SetupSecret {
  key: string;
  message: string;
  description?: string;
  default?: string;
}

/**
 * Binary distribution configuration for install.sh generation.
 *
 * @example GitHub Releases
 * install: { type: "github", repo: "myorg/myctl" }
 *
 * @example Self-hosted
 * install: { type: "custom", url: "https://cli.mycompany.com/releases/v{VERSION}" }
 */
export type InstallConfig =
  | { type: "github"; repo: string }
  | { type: "custom"; url: string };

export interface CliConfig {
  name: string;
  displayName?: string;
  version?: string;
  description?: string;
  pluginDirs?: string[];
  install?: InstallConfig;
  /** @deprecated Use `install: { type: "github", repo: "owner/repo" }` instead. */
  repository?: string;
  setup?: { secrets?: SetupSecret[] };
}

export interface CliConfigDef extends CliConfig {
  version: string;
  entry?: string;
  outfile?: string;
}

// ---------------------------------------------------------------------------
// Prompt types & errors
// ---------------------------------------------------------------------------

export class NonTtyError extends Error {}
export class PromptCancelledError extends Error {}

export interface TextPromptOptions {
  message: string;
  default?: string;
  validate?: (value: string) => string | undefined;
  signal?: AbortSignal;
}

export interface SelectPromptOptions {
  message: string;
  choices: string[];
  default?: string;
  signal?: AbortSignal;
}

export interface ConfirmPromptOptions {
  message: string;
  default?: boolean;
  signal?: AbortSignal;
}

export interface MultiSelectPromptOptions {
  message: string;
  choices: string[];
  defaults?: string[];
  signal?: AbortSignal;
}

export interface AutocompletePromptOptions {
  message: string;
  choices: string[] | ((query: string, signal: AbortSignal) => Promise<string[]>);
  default?: string;
  debounceMs?: number;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Define a command with schema-inferred arg types.
 * TypeScript narrows `args` in `run` based on the schema — no casts needed.
 */
export declare function defineCommand<S extends ArgSchema>(def: {
  name: string;
  aliases?: string[];
  description: string;
  schema?: S;
  subcommands?: SubcommandDef[];
  run?(args: ParsedArgs, runtime: Runtime): Promise<void>;
}): CommandDef;

/**
 * Define a subcommand with schema-inferred arg types.
 */
export declare function defineSubcommand<S extends ArgSchema>(def: {
  name: string;
  aliases?: string[];
  description: string;
  schema?: S;
  run(args: ParsedArgs, runtime: Runtime): Promise<void>;
}): SubcommandDef;

/**
 * Create a CLI instance. Call `.run()` in your entry file.
 */
export declare function createCli(
  config: CliConfig,
  commands?: CommandDef[],
): { run(argv?: string[]): Promise<void> };

/**
 * Define a CLI configuration with full type checking.
 * Place in `cli.config.ts`.
 */
export declare function defineConfig(config: CliConfigDef): CliConfigDef;

/** Interactive free-text prompt. */
export declare function text(opts: TextPromptOptions): Promise<string>;

/** Interactive pick-one list prompt. */
export declare function select(opts: SelectPromptOptions): Promise<string>;

/** Interactive yes/no confirmation. */
export declare function confirm(opts: ConfirmPromptOptions): Promise<boolean>;

/** Interactive multi-selection prompt. */
export declare function multiSelect(opts: MultiSelectPromptOptions): Promise<string[]>;

/** Interactive autocomplete prompt with fuzzy filtering or dynamic fetch. */
export declare function autocomplete(opts: AutocompletePromptOptions): Promise<string>;
