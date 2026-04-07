import type { Key, ConfirmPromptOptions } from "./types.ts";
import { style } from "./ansi.ts";
import { runPromptLoop, printAnswer, handleCancelled } from "./runner.ts";

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export interface ConfirmState {
  answer: boolean | undefined;
  done: boolean;
  cancelled: boolean;
}

export function confirmReducer(state: ConfirmState, key: Key, defaultValue: boolean): ConfirmState {
  if (state.done || state.cancelled) return state;

  switch (key.type) {
    case "interrupt":
    case "escape":
      return { ...state, cancelled: true };

    case "enter":
      return { ...state, answer: state.answer ?? defaultValue, done: true };

    case "char": {
      const ch = key.char.toLowerCase();
      if (ch === "y") return { answer: true, done: true, cancelled: false };
      if (ch === "n") return { answer: false, done: true, cancelled: false };
      return state;
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

function renderConfirm(state: ConfirmState, opts: ConfirmPromptOptions): string {
  const hint = opts.default === true ? "Y/n" : "y/N";
  const question = `${style.cyan("?")} ${style.bold(opts.message)} ${style.dim(`(${hint})`)} `;

  if (state.done) {
    return `${style.green("✓")} ${style.bold(opts.message)} ${style.dim(state.answer ? "yes" : "no")}`;
  }
  if (state.cancelled) {
    return `${style.red("✗")} ${style.bold(opts.message)}`;
  }

  return question;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function confirm(opts: ConfirmPromptOptions): Promise<boolean> {
  let state: ConfirmState = { answer: undefined, done: false, cancelled: false };
  const defaultValue = opts.default ?? false;

  const result = await runPromptLoop(
    () => renderConfirm(state, opts),
    (key) => {
      state = confirmReducer(state, key, defaultValue);
      if (state.done) return "done";
      if (state.cancelled) return "cancelled";
      return "continue";
    },
    opts.signal,
  );

  if (result === "cancelled") {
    handleCancelled(renderConfirm({ ...state, cancelled: true }, opts));
  }

  printAnswer(renderConfirm(state, opts));
  return state.answer!;
}
