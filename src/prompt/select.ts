import type { Key, SelectPromptOptions } from "./types.ts";
import { style } from "./ansi.ts";
import { runPromptLoop, printAnswer, handleCancelled } from "./runner.ts";

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export interface SelectState {
  choices: string[];
  index: number;
  done: boolean;
  cancelled: boolean;
}

export function selectReducer(state: SelectState, key: Key): SelectState {
  if (state.done || state.cancelled) return state;

  const { choices, index } = state;

  switch (key.type) {
    case "interrupt":
    case "escape":
      return { ...state, cancelled: true };

    case "enter":
      return { ...state, done: true };

    case "up":
      return { ...state, index: (index - 1 + choices.length) % choices.length };

    case "down":
      return { ...state, index: (index + 1) % choices.length };

    case "home":
      return { ...state, index: 0 };

    case "end":
      return { ...state, index: choices.length - 1 };

    case "char": {
      // Jump to first item starting with the typed character
      const ch = key.char.toLowerCase();
      const match = choices.findIndex((c) => c.toLowerCase().startsWith(ch));
      if (match !== -1) return { ...state, index: match };
      return state;
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export function renderSelect(state: SelectState, opts: SelectPromptOptions): string {
  if (state.done) {
    return `${style.green("✓")} ${style.bold(opts.message)} ${style.dim(state.choices[state.index]!)}`;
  }
  if (state.cancelled) {
    return `${style.red("✗")} ${style.bold(opts.message)}`;
  }

  const lines = [
    `${style.cyan("?")} ${style.bold(opts.message)} ${style.dim("(↑↓ to move, Enter to select)")}`,
    ...state.choices.map((choice, i) =>
      i === state.index
        ? `  ${style.cyan("❯")} ${style.bold(choice)}`
        : `    ${choice}`,
    ),
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function select(opts: SelectPromptOptions): Promise<string> {
  const defaultIndex = opts.default
    ? Math.max(0, opts.choices.indexOf(opts.default))
    : 0;

  let state: SelectState = {
    choices: opts.choices,
    index: defaultIndex,
    done: false,
    cancelled: false,
  };

  const result = await runPromptLoop(
    () => renderSelect(state, opts),
    (key) => {
      state = selectReducer(state, key);
      if (state.done) return "done";
      if (state.cancelled) return "cancelled";
      return "continue";
    },
    opts.signal,
  );

  if (result === "cancelled") {
    handleCancelled(renderSelect({ ...state, cancelled: true }, opts));
  }

  printAnswer(renderSelect(state, opts));
  return state.choices[state.index]!;
}
