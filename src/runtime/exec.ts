// ---------------------------------------------------------------------------
// Shell / process execution
// ---------------------------------------------------------------------------

/** Thrown by runtime.exec.run() when a command exits with a non-zero code. */
export class ExecError extends Error {
  constructor(
    public readonly exitCode: number,
    /** The command string or joined args passed to run(). */
    public readonly command: string,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    super(
      `Command failed (exit ${exitCode}): ${command}` +
      (stderr.trim() ? `\n${stderr.trim()}` : ""),
    );
    this.name = "ExecError";
  }
}

export interface ExecOptions {
  /** Working directory. Defaults to process.cwd(). */
  cwd?: string;
  /**
   * Extra environment variables merged on top of the current environment.
   * Use `env: {}` to pass no extras; the parent process env is always included.
   */
  env?: Record<string, string>;
  /** String piped to stdin. */
  stdin?: string;
  /**
   * When true, a non-zero exit code does not throw — check result.ok instead.
   * Default: false (throws ExecError on non-zero exit).
   */
  noThrow?: boolean;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** True when exitCode === 0. */
  ok: boolean;
  /** stdout split into non-empty trimmed lines. */
  lines(): string[];
  /** stdout parsed as JSON. */
  json<T = unknown>(): T;
}

export interface ExecInterface {
  /**
   * Run a command and capture its output.
   *
   * - Pass a **string** to run through the shell (`/bin/sh -c`), which
   *   supports pipes, redirects, and other shell features.
   * - Pass a **string array** to exec directly — no shell, no injection risk.
   *
   * Throws ExecError on non-zero exit unless `options.noThrow` is true.
   * The command is automatically aborted when `runtime.signal` fires.
   *
   * @example
   * const { stdout } = await runtime.exec.run("git log --oneline | head -5");
   * const result = await runtime.exec.run(["git", "diff", "--exit-code"], { noThrow: true });
   * if (!result.ok) runtime.print("Uncommitted changes");
   */
  run(command: string | string[], options?: ExecOptions): Promise<ExecResult>;

  /**
   * Run a command with stdio inherited from the parent process.
   * Use for interactive programs (editors, pagers, prompts) or when you
   * want the command's output to stream directly to the terminal.
   * Returns the exit code.
   *
   * @example
   * const code = await runtime.exec.interactive(["vim", filePath]);
   */
  interactive(command: string | string[], options?: Omit<ExecOptions, "stdin">): Promise<number>;

  /** The error class thrown on non-zero exit. */
  ExecError: typeof ExecError;
}

// ---------------------------------------------------------------------------
// Real implementation
// ---------------------------------------------------------------------------

export function createExec(signal: AbortSignal): ExecInterface {
  function toArgs(command: string | string[]): [string[], string] {
    if (Array.isArray(command)) return [command, command.join(" ")];
    return [["sh", "-c", command], command];
  }

  function mergeEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
    return extra ? { ...process.env, ...extra } : process.env;
  }

  async function run(command: string | string[], options?: ExecOptions): Promise<ExecResult> {
    const [args, label] = toArgs(command);

    const proc = Bun.spawn(args, {
      cwd:    options?.cwd,
      env:    mergeEnv(options?.env),
      stdin:  options?.stdin !== undefined ? Buffer.from(options.stdin) : "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wire cancellation — kill the process when the runtime signal fires
    const onAbort = () => proc.kill();
    signal.addEventListener("abort", onAbort, { once: true });

    let stdout = "";
    let stderr = "";
    try {
      [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }

    const exitCode = await proc.exited;
    const result: ExecResult = {
      exitCode,
      stdout,
      stderr,
      ok: exitCode === 0,
      lines: () => stdout.split("\n").map((l) => l.trim()).filter(Boolean),
      json:  <T>() => JSON.parse(stdout) as T,
    };

    if (!options?.noThrow && exitCode !== 0) {
      throw new ExecError(exitCode, label, stdout, stderr);
    }

    return result;
  }

  async function interactive(
    command: string | string[],
    options?: Omit<ExecOptions, "stdin">,
  ): Promise<number> {
    const [args] = toArgs(command);

    const proc = Bun.spawn(args, {
      cwd:    options?.cwd,
      env:    mergeEnv(options?.env),
      stdin:  "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    const onAbort = () => proc.kill();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      return await proc.exited;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  return { run, interactive, ExecError };
}

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------

export interface MockExecCall {
  command: string | string[];
  options?: ExecOptions | Omit<ExecOptions, "stdin">;
}

function makeResult(exitCode: number, stdout: string, stderr: string): ExecResult {
  return {
    exitCode,
    stdout,
    stderr,
    ok: exitCode === 0,
    lines: () => stdout.split("\n").map((l) => l.trim()).filter(Boolean),
    json:  <T>() => JSON.parse(stdout) as T,
  };
}

export function createMockExec(): ExecInterface & {
  /** All exec calls made, in order. */
  calls: MockExecCall[];
  /**
   * Pre-configure the result for a command.
   * `command` matches the string passed to run(), or joined args for arrays.
   */
  mockResult(command: string, result: { exitCode?: number; stdout?: string; stderr?: string }): void;
} {
  const calls: MockExecCall[] = [];
  const mocked = new Map<string, { exitCode: number; stdout: string; stderr: string }>();

  function lookup(command: string | string[]) {
    const key = Array.isArray(command) ? command.join(" ") : command;
    return { key, preset: mocked.get(key) };
  }

  return {
    calls,

    async run(command, options) {
      const { key, preset } = lookup(command);
      calls.push({ command, options });
      const exitCode = preset?.exitCode ?? 0;
      const stdout   = preset?.stdout   ?? "";
      const stderr   = preset?.stderr   ?? "";
      if (!options?.noThrow && exitCode !== 0) {
        throw new ExecError(exitCode, key, stdout, stderr);
      }
      return makeResult(exitCode, stdout, stderr);
    },

    async interactive(command, options) {
      const { preset } = lookup(command);
      calls.push({ command, options });
      return preset?.exitCode ?? 0;
    },

    ExecError,

    mockResult(command, result) {
      mocked.set(command, {
        exitCode: result.exitCode ?? 0,
        stdout:   result.stdout   ?? "",
        stderr:   result.stderr   ?? "",
      });
    },
  };
}
