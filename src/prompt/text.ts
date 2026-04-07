import type { Key, TextPromptOptions } from "./types.ts";
import { style, cursor } from "./ansi.ts";
import { runPromptLoop, printAnswer, handleCancelled } from "./runner.ts";

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export interface TextState {
  value: string;
  cursor: number;
  /**
   * When true the current value is the default being shown as a placeholder
   * (rendered dimmed). The first printable keypress replaces it entirely;
   * cursor movement / backspace switches to normal editing instead.
   */
  isPlaceholder: boolean;
  error: string | undefined;
  done: boolean;
  cancelled: boolean;
}

export function textReducer(
  state: TextState,
  key: Key,
  validate?: (v: string) => string | undefined,
): TextState {
  if (state.done || state.cancelled) return state;

  switch (key.type) {
    case "interrupt":
    case "escape":
      return { ...state, cancelled: true };

    case "enter": {
      const err = validate?.(state.value);
      if (err) return { ...state, error: err };
      return { ...state, isPlaceholder: false, error: undefined, done: true };
    }

    case "char":
      if (state.isPlaceholder) {
        // First keystroke replaces the placeholder entirely
        return {
          value: key.char,
          cursor: 1,
          isPlaceholder: false,
          error: undefined,
          done: false,
          cancelled: false,
        };
      }
      return insertChar(state, key.char);

    case "backspace":
      if (state.isPlaceholder) {
        // Backspace on a placeholder clears it
        return { ...state, value: "", cursor: 0, isPlaceholder: false };
      }
      return deleteBack(state);

    case "delete":
      if (state.isPlaceholder) {
        return { ...state, value: "", cursor: 0, isPlaceholder: false };
      }
      return deleteForward(state);

    case "left":
      // Cursor movement deactivates placeholder mode — user is editing the default
      return { ...state, isPlaceholder: false, cursor: Math.max(0, state.cursor - 1) };

    case "right":
      return {
        ...state,
        isPlaceholder: false,
        cursor: Math.min(state.value.length, state.cursor + 1),
      };

    case "home":
      return { ...state, isPlaceholder: false, cursor: 0 };

    case "end":
      return { ...state, isPlaceholder: false, cursor: state.value.length };

    default:
      return state;
  }
}

function insertChar(state: TextState, char: string): TextState {
  const { value, cursor: pos } = state;
  return {
    ...state,
    value: value.slice(0, pos) + char + value.slice(pos),
    cursor: pos + 1,
    error: undefined,
  };
}

function deleteBack(state: TextState): TextState {
  const { value, cursor: pos } = state;
  if (pos === 0) return state;
  return {
    ...state,
    value: value.slice(0, pos - 1) + value.slice(pos),
    cursor: pos - 1,
  };
}

function deleteForward(state: TextState): TextState {
  const { value, cursor: pos } = state;
  if (pos === value.length) return state;
  return {
    ...state,
    value: value.slice(0, pos) + value.slice(pos + 1),
  };
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

function renderText(state: TextState, opts: TextPromptOptions): string {
  if (state.done) {
    return `${style.green("✓")} ${style.bold(opts.message)} ${style.dim(state.value)}`;
  }
  if (state.cancelled) {
    return `${style.red("✗")} ${style.bold(opts.message)}`;
  }

  // Show placeholder (default) dimmed; active input shown normally
  const displayValue = state.isPlaceholder ? style.dim(state.value) : state.value;
  const lines = [`${style.cyan("?")} ${style.bold(opts.message)} ${displayValue}`];
  if (state.error) lines.push(`  ${style.red(state.error)}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function text(opts: TextPromptOptions): Promise<string> {
  let state: TextState = {
    value: opts.default ?? "",
    cursor: (opts.default ?? "").length,
    isPlaceholder: !!opts.default,
    error: undefined,
    done: false,
    cancelled: false,
  };

  const result = await runPromptLoop(
    () => {
      const line = renderText(state, opts);
      const inputCol = `? ${opts.message} `.length + state.cursor + 1;
      return line + cursor.col(inputCol);
    },
    (key) => {
      state = textReducer(state, key, opts.validate);
      if (state.done) return "done";
      if (state.cancelled) return "cancelled";
      return "continue";
    },
    opts.signal,
  );

  if (result === "cancelled") {
    handleCancelled(renderText({ ...state, cancelled: true }, opts));
  }

  printAnswer(renderText(state, opts));
  return state.value;
}
