import { NonTtyError, PromptCancelledError } from "./types.ts";
import { cursor, clearAbove, countLines } from "./ansi.ts";
import { makeKeyReader } from "./input.ts";
import type { Key } from "./types.ts";

/**
 * Runs an interactive prompt loop.
 *
 * Handles: TTY check, raw mode, cursor hiding, initial render, key dispatch,
 * re-render on each key, and terminal cleanup in all exit paths.
 *
 * @param render    Returns the current prompt UI as a string (may contain newlines).
 *                  Called before each key dispatch and once more for the final state.
 * @param onKey     Receives each key and returns "continue", "done", or "cancelled".
 * @param signal    Optional AbortSignal — if aborted, cancels the prompt.
 */
export async function runPromptLoop(
  render: () => string,
  onKey: (key: Key) => "continue" | "done" | "cancelled",
  signal?: AbortSignal,
): Promise<"done" | "cancelled"> {
  if (!process.stdin.isTTY) throw new NonTtyError();

  process.stdout.write(cursor.hide);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  const { next, cleanup } = makeKeyReader();
  // -1 = not yet rendered; skip clearAbove on the first draw so we don't
  // erase the current terminal line before writing anything.
  let linesRendered = -1;

  const redraw = () => {
    if (linesRendered >= 0) {
      process.stdout.write(clearAbove(linesRendered));
    }
    const output = render();
    process.stdout.write(output);
    linesRendered = countLines(output);
  };

  try {
    redraw();

    while (true) {
      if (signal?.aborted) {
        return "cancelled";
      }

      const key = await Promise.race([
        next(),
        signal
          ? new Promise<Key>((_, reject) => {
              signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            })
          : new Promise<never>(() => { /* never resolves if no signal */ }),
      ]).catch(() => ({ type: "interrupt" }) as Key);

      const result = onKey(key);
      if (result !== "continue") {
        return result;
      }
      redraw();
    }
  } finally {
    cleanup();
    if (linesRendered >= 0) process.stdout.write(clearAbove(linesRendered));
    process.stdout.write(cursor.show);
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

/**
 * Writes the final "answered" line and a trailing newline.
 * Called after runPromptLoop returns "done".
 */
export function printAnswer(line: string): void {
  process.stdout.write(line + "\n");
}

/**
 * Writes the "cancelled" line, a trailing newline, and throws PromptCancelledError.
 */
export function handleCancelled(line: string): never {
  process.stdout.write(line + "\n");
  throw new PromptCancelledError();
}
