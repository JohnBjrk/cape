import type { ParsedArgs } from "../parser/types.ts";
import type { Runtime } from "./types.ts";
import { createMockOutput, type OutputInterface, type OutputCall } from "./output.ts";
import { createMockFs, type FsInterface, type MockFsEntry } from "./fs.ts";
import { createMockStdin, type StdinInterface } from "./stdin.ts";
import { createMockLog, type LogInterface, type LogCall } from "./log.ts";
import { createMockSignalManager } from "./signal.ts";
import { createMockSecrets, type SecretsInterface } from "./secrets.ts";
import { NonTtyError, PromptCancelledError, type PromptInterface } from "../prompt/types.ts";

interface MockRuntimeOptions {
  args?: Partial<ParsedArgs>;
  env?: Record<string, string>;
  stdinContent?: string;
  stdinIsTTY?: boolean;
  secrets?: Record<string, string>;
  config?: Record<string, unknown>;
  commandConfig?: Record<string, unknown>;
  /** Virtual filesystem entries: path → content. */
  files?: Record<string, MockFsEntry>;
  cliName?: string;
}

export class MockRuntime implements Runtime {
  args: ParsedArgs;
  env: Record<string, string>;
  output: OutputInterface;
  fs: FsInterface;
  stdin: StdinInterface;
  log: LogInterface;
  signal: AbortSignal;
  secrets: SecretsInterface;
  config: Record<string, unknown>;
  commandConfig: Record<string, unknown>;
  prompt: PromptInterface = {
    text:         () => Promise.reject(new NonTtyError()),
    confirm:      () => Promise.reject(new NonTtyError()),
    select:       () => Promise.reject(new NonTtyError()),
    multiSelect:  () => Promise.reject(new NonTtyError()),
    autocomplete: () => Promise.reject(new NonTtyError()),
    NonTtyError,
    PromptCancelledError,
  };

  // Convenience accessors for assertions
  readonly printed: string[] = [];
  readonly errors: string[] = [];
  exitCode: number | undefined;

  /** All output method calls, in order. */
  get outputCalls(): OutputCall[] { return (this.output as ReturnType<typeof createMockOutput>).calls; }
  /** All log calls. */
  get logCalls(): LogCall[] { return (this.log as ReturnType<typeof createMockLog>).calls; }
  /** Secret store (readable in tests). */
  get secretStore(): Map<string, string> {
    return (this.secrets as ReturnType<typeof createMockSecrets>).store;
  }
  /** Virtual filesystem (readable / writable in tests). */
  get fsFiles(): Map<string, MockFsEntry> {
    return (this.fs as ReturnType<typeof createMockFs>).files;
  }

  private _signalManager: ReturnType<typeof createMockSignalManager>;

  constructor(options: MockRuntimeOptions = {}) {
    this.args = {
      flags: {},
      positionals: [],
      passthrough: [],
      provided: new Set<string>(),
      ...options.args,
    };
    this.env = options.env ?? {};
    this.config        = options.config ?? {};
    this.commandConfig = options.commandConfig ?? {};

    const mockOutput = createMockOutput();
    // Also mirror print/printError to the legacy arrays for convenience
    const origPrint = mockOutput.print.bind(mockOutput);
    const origError = mockOutput.printError.bind(mockOutput);
    mockOutput.print      = (t) => { this.printed.push(t); origPrint(t); };
    mockOutput.printError = (t) => { this.errors.push(t);  origError(t); };
    this.output = mockOutput;

    const mockFs = createMockFs(options.cliName ?? "test");
    if (options.files) {
      for (const [path, content] of Object.entries(options.files)) {
        mockFs.files.set(path, content);
      }
    }
    this.fs = mockFs;

    this.stdin   = createMockStdin(options.stdinContent ?? "", options.stdinIsTTY ?? false);
    this.log     = createMockLog();
    this.secrets = createMockSecrets(options.secrets ?? {});

    this._signalManager = createMockSignalManager();
    this.signal = this._signalManager.signal;
  }

  print(text: string): void {
    this.printed.push(text);
  }

  printError(text: string): void {
    this.errors.push(text);
  }

  exit(code: number): never {
    this.exitCode = code;
    throw new MockExitError(code);
  }

  onExit(fn: () => void | Promise<void>): void {
    this._signalManager.onExit(fn);
  }

  /** Simulate receiving SIGINT / SIGTERM. Runs all registered onExit handlers. */
  async abort(): Promise<void> {
    this._signalManager.abort();
    for (const fn of [...this._signalManager.exitHandlers].reverse()) {
      try { await fn(); } catch { /* swallow */ }
    }
  }
}

export class MockExitError extends Error {
  constructor(public readonly code: number) {
    super(`Process exited with code ${code}`);
  }
}
