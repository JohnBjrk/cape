import { style, cursor, erase } from "../prompt/ansi.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TableOptions {
  /** Explicit column order. Defaults to keys of the first row. */
  columns?: string[];
}

export interface Spinner {
  /** Update the spinner message while it's running. */
  update(message: string): void;
  /** Stop and print a success line. */
  succeed(message?: string): void;
  /** Stop and print a failure line. */
  fail(message?: string): void;
  /** Stop and erase the spinner without printing anything. */
  stop(): void;
}

export interface ProgressBar {
  /** Advance by n (default 1). */
  tick(n?: number): void;
  /** Update the total. */
  setTotal(total: number): void;
  /** Mark complete and optionally print a final message. */
  done(message?: string): void;
}

export interface OutputInterface {
  /** Raw text line — same as runtime.print(). */
  print(text: string): void;
  /** Raw error line — same as runtime.printError(). */
  printError(text: string): void;

  /** Green checkmark + message. Silent when --quiet. */
  success(message: string): void;
  /** Yellow warning + message. Always shown. */
  warn(message: string): void;
  /** Emit `value` as pretty-printed JSON. Bypasses --quiet. */
  json(value: unknown): void;

  /**
   * Render an array of row objects as a table.
   * TTY → box-drawing table. Pipe → tab-separated values.
   */
  table(rows: Record<string, unknown>[], opts?: TableOptions): void;
  /** Render a list of strings. TTY → bullets, pipe → plain lines. */
  list(items: string[]): void;

  /** Start a spinner with an initial message. */
  spinner(message: string): Spinner;
  /** Run `fn`, show a spinner while it executes, then stop. */
  withSpinner<T>(message: string, fn: (spinner: Spinner) => Promise<T>): Promise<T>;

  /** Create a progress bar with the given total. */
  progressBar(total: number): ProgressBar;
  /** Run `fn` with a tick callback, show progress while it executes. */
  withProgressBar<T>(total: number, fn: (tick: (n?: number) => void) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// Real implementation (wired to process.stdout / stderr)
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_MS = 80;
const PROGRESS_WIDTH = 28;

interface OutputOptions {
  noColor: boolean;
  quiet: boolean;
  /** Whether stdout is a TTY (for table/spinner/progress rendering). */
  isTTY: boolean;
}

export function createOutput(opts: OutputOptions): OutputInterface {
  const { noColor, quiet, isTTY } = opts;

  const c = noColor
    ? { bold: (s: string) => s, dim: (s: string) => s, cyan: (s: string) => s, green: (s: string) => s, red: (s: string) => s, yellow: (s: string) => s }
    : style;

  function print(text: string) { process.stdout.write(text + "\n"); }
  function printError(text: string) { process.stderr.write(text + "\n"); }
  function success(message: string) {
    if (quiet) return;
    print(`${c.green("✓")} ${message}`);
  }
  function warn(message: string) {
    printError(`${c.yellow("⚠")} ${message}`);
  }
  function jsonOut(value: unknown) {
    print(JSON.stringify(value, null, 2));
  }

  function table(rows: Record<string, unknown>[], tableOpts?: TableOptions) {
    if (rows.length === 0) return;

    const columns = tableOpts?.columns ?? Object.keys(rows[0]!);
    if (columns.length === 0) return;

    if (!isTTY) {
      // Pipe: tab-separated
      print(columns.join("\t"));
      for (const row of rows) {
        print(columns.map((col) => String(row[col] ?? "")).join("\t"));
      }
      return;
    }

    // TTY: box-drawing table
    const widths = columns.map((col) => {
      const headerLen = col.length;
      const maxDataLen = Math.max(...rows.map((r) => String(r[col] ?? "").length));
      return Math.max(headerLen, maxDataLen);
    });

    const top    = "┌" + widths.map((w) => "─".repeat(w + 2)).join("┬") + "┐";
    const mid    = "├" + widths.map((w) => "─".repeat(w + 2)).join("┼") + "┤";
    const bottom = "└" + widths.map((w) => "─".repeat(w + 2)).join("┴") + "┘";

    const header = "│" + columns.map((col, i) => ` ${c.bold(col.padEnd(widths[i]!))} `).join("│") + "│";

    print(top);
    print(header);
    print(mid);
    for (const row of rows) {
      const line = "│" + columns.map((col, i) => ` ${String(row[col] ?? "").padEnd(widths[i]!)} `).join("│") + "│";
      print(line);
    }
    print(bottom);
  }

  function list(items: string[]) {
    if (!isTTY) {
      for (const item of items) print(item);
      return;
    }
    for (const item of items) {
      print(`  ${c.cyan("•")} ${item}`);
    }
  }

  function spinner(message: string): Spinner {
    if (!isTTY) return createNoOpSpinner(message, print, printError, noColor);
    return createRealSpinner(message, noColor);
  }

  async function withSpinner<T>(message: string, fn: (s: Spinner) => Promise<T>): Promise<T> {
    const s = spinner(message);
    try {
      const result = await fn(s);
      s.succeed();
      return result;
    } catch (err) {
      s.fail();
      throw err;
    }
  }

  function progressBar(total: number): ProgressBar {
    if (!isTTY) return createNoOpProgressBar();
    return createRealProgressBar(total, noColor);
  }

  async function withProgressBar<T>(total: number, fn: (tick: (n?: number) => void) => Promise<T>): Promise<T> {
    const bar = progressBar(total);
    try {
      return await fn((n) => bar.tick(n));
    } finally {
      bar.done();
    }
  }

  return { print, printError, success, warn, json: jsonOut, table, list, spinner, withSpinner, progressBar, withProgressBar };
}

// ---------------------------------------------------------------------------
// Real spinner (TTY)
// ---------------------------------------------------------------------------

function createRealSpinner(initialMessage: string, noColor: boolean): Spinner {
  let message = initialMessage;
  let frame = 0;
  let stopped = false;

  const c = noColor ? (s: string) => s : style.cyan;

  process.stdout.write(cursor.hide);

  const timer = setInterval(() => {
    if (stopped) return;
    const f = SPINNER_FRAMES[frame % SPINNER_FRAMES.length]!;
    frame++;
    process.stdout.write(`\r${c(f)} ${message}`);
  }, SPINNER_MS);

  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    process.stdout.write("\r" + erase.line);
    process.stdout.write(cursor.show);
  }

  return {
    update(msg) { message = msg; },
    stop,
    succeed(msg) {
      stop();
      const text = msg ?? message;
      const prefix = noColor ? "✓" : style.green("✓");
      process.stdout.write(`${prefix} ${text}\n`);
    },
    fail(msg) {
      stop();
      const text = msg ?? message;
      const prefix = noColor ? "✗" : style.red("✗");
      process.stderr.write(`${prefix} ${text}\n`);
    },
  };
}

// No-op spinner for non-TTY (succeed/fail still emit lines)
function createNoOpSpinner(message: string, print: (s: string) => void, printError: (s: string) => void, noColor: boolean): Spinner {
  let current = message;
  const c = noColor ? { green: (s: string) => s, red: (s: string) => s } : style;
  return {
    update(msg) { current = msg; },
    stop() {},
    succeed(msg) { print(`${c.green("✓")} ${msg ?? current}`); },
    fail(msg) { printError(`${c.red("✗")} ${msg ?? current}`); },
  };
}

// ---------------------------------------------------------------------------
// Real progress bar (TTY)
// ---------------------------------------------------------------------------

function createRealProgressBar(initialTotal: number, noColor: boolean): ProgressBar {
  let current = 0;
  let total = initialTotal;

  function render() {
    const pct = total > 0 ? current / total : 0;
    const filled = Math.floor(pct * PROGRESS_WIDTH);
    const arrow = filled < PROGRESS_WIDTH ? ">" : "";
    const empty = Math.max(0, PROGRESS_WIDTH - filled - (arrow ? 1 : 0));
    const bar = "=".repeat(filled) + arrow + " ".repeat(empty);
    const text = `\r[${bar}] ${current}/${total}`;
    process.stdout.write(noColor ? text : style.cyan(text));
  }

  render();

  return {
    tick(n = 1) {
      current = Math.min(total, current + n);
      render();
    },
    setTotal(n) {
      total = n;
      render();
    },
    done(message) {
      current = total;
      render();
      process.stdout.write("\n");
      if (message) process.stdout.write(message + "\n");
    },
  };
}

function createNoOpProgressBar(): ProgressBar {
  return { tick() {}, setTotal() {}, done() {} };
}

// ---------------------------------------------------------------------------
// Mock output (for testing)
// ---------------------------------------------------------------------------

export type OutputCall =
  | { type: "print"; text: string }
  | { type: "printError"; text: string }
  | { type: "success"; message: string }
  | { type: "warn"; message: string }
  | { type: "json"; value: unknown }
  | { type: "table"; rows: Record<string, unknown>[]; opts?: TableOptions }
  | { type: "list"; items: string[] }
  | { type: "spinner"; message: string }
  | { type: "progressBar"; total: number };

/** Mock OutputInterface that records all calls for use in tests. */
export function createMockOutput(): OutputInterface & { calls: OutputCall[] } {
  const calls: OutputCall[] = [];

  const noOpSpinner: Spinner = { update() {}, succeed() {}, fail() {}, stop() {} };
  const noOpBar: ProgressBar = { tick() {}, setTotal() {}, done() {} };

  return {
    calls,
    print(text) { calls.push({ type: "print", text }); },
    printError(text) { calls.push({ type: "printError", text }); },
    success(message) { calls.push({ type: "success", message }); },
    warn(message) { calls.push({ type: "warn", message }); },
    json(value) { calls.push({ type: "json", value }); },
    table(rows, opts) { calls.push({ type: "table", rows, opts }); },
    list(items) { calls.push({ type: "list", items }); },
    spinner(message) { calls.push({ type: "spinner", message }); return noOpSpinner; },
    async withSpinner<T>(message: string, fn: (s: Spinner) => Promise<T>) {
      calls.push({ type: "spinner", message });
      return fn(noOpSpinner);
    },
    progressBar(total) { calls.push({ type: "progressBar", total }); return noOpBar; },
    async withProgressBar<T>(total: number, fn: (tick: (n?: number) => void) => Promise<T>) {
      calls.push({ type: "progressBar", total });
      return fn(() => {});
    },
  };
}
