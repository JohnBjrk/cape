import { style } from "../prompt/ansi.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LogInterface {
  /**
   * Log a verbose message.
   * Only printed when the user passed `--verbose` or `--debug`.
   */
  verbose(message: string): void;
  /**
   * Log a debug message.
   * Only printed when the user passed `--debug`.
   */
  debug(message: string): void;
}

// ---------------------------------------------------------------------------
// Real implementation
// ---------------------------------------------------------------------------

interface LogOptions {
  verbose: boolean;
  debug: boolean;
  noColor: boolean;
}

export function createLog(opts: LogOptions): LogInterface {
  const { noColor } = opts;
  const isVerbose = opts.verbose || opts.debug;
  const isDebug   = opts.debug;

  const dim   = noColor ? (s: string) => s : style.dim;

  return {
    verbose(message) {
      if (!isVerbose) return;
      process.stderr.write(dim(`[verbose] ${message}`) + "\n");
    },
    debug(message) {
      if (!isDebug) return;
      process.stderr.write(dim(`[debug] ${message}`) + "\n");
    },
  };
}

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------

export type LogCall = { level: "verbose" | "debug"; message: string };

/** Mock LogInterface that records all log calls for use in tests. */
export function createMockLog(): LogInterface & { calls: LogCall[] } {
  const calls: LogCall[] = [];
  return {
    calls,
    verbose(message) { calls.push({ level: "verbose", message }); },
    debug(message)   { calls.push({ level: "debug",   message }); },
  };
}
