import type { Key, MultiSelectPromptOptions } from "./types.ts";
import { style } from "./ansi.ts";
import { runPromptLoop, printAnswer, handleCancelled } from "./runner.ts";

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export interface MultiSelectState {
  choices: string[];
  index: number;
  checked: Set<number>;
  done: boolean;
  cancelled: boolean;
}

export function multiSelectReducer(state: MultiSelectState, key: Key): MultiSelectState {
  if (state.done || state.cancelled) return state;

  const { choices, index, checked } = state;

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

    case "char":
      if (key.char === " ") return toggleCurrent(state);
      if (key.char === "a") return toggleAll(state);
      return state;

    default:
      return state;
  }
}

function toggleCurrent(state: MultiSelectState): MultiSelectState {
  const next = new Set(state.checked);
  if (next.has(state.index)) next.delete(state.index);
  else next.add(state.index);
  return { ...state, checked: next };
}

function toggleAll(state: MultiSelectState): MultiSelectState {
  if (state.checked.size === state.choices.length) {
    return { ...state, checked: new Set() };
  }
  return { ...state, checked: new Set(state.choices.map((_, i) => i)) };
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export function renderMultiSelect(state: MultiSelectState, opts: MultiSelectPromptOptions): string {
  if (state.done) {
    const selected = state.choices.filter((_, i) => state.checked.has(i));
    return `${style.green("✓")} ${style.bold(opts.message)} ${style.dim(selected.join(", ") || "(none)")}`;
  }
  if (state.cancelled) {
    return `${style.red("✗")} ${style.bold(opts.message)}`;
  }

  const lines = [
    `${style.cyan("?")} ${style.bold(opts.message)} ${style.dim("(↑↓ move, Space toggle, a all, Enter confirm)")}`,
    ...state.choices.map((choice, i) => {
      const checked = state.checked.has(i) ? style.green("◉") : "○";
      const label = i === state.index ? style.bold(style.cyan(choice)) : choice;
      const pointer = i === state.index ? style.cyan("❯") : " ";
      return `  ${pointer} ${checked} ${label}`;
    }),
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function multiSelect(opts: MultiSelectPromptOptions): Promise<string[]> {
  const defaultChecked = new Set(
    (opts.defaults ?? []).map((d) => opts.choices.indexOf(d)).filter((i) => i !== -1),
  );

  let state: MultiSelectState = {
    choices: opts.choices,
    index: 0,
    checked: defaultChecked,
    done: false,
    cancelled: false,
  };

  const result = await runPromptLoop(
    () => renderMultiSelect(state, opts),
    (key) => {
      state = multiSelectReducer(state, key);
      if (state.done) return "done";
      if (state.cancelled) return "cancelled";
      return "continue";
    },
    opts.signal,
  );

  if (result === "cancelled") {
    handleCancelled(renderMultiSelect({ ...state, cancelled: true }, opts));
  }

  printAnswer(renderMultiSelect(state, opts));
  return state.choices.filter((_, i) => state.checked.has(i));
}
