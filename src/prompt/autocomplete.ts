import type { Key, AutocompletePromptOptions } from "./types.ts";
import { style } from "./ansi.ts";
import { runPromptLoop, printAnswer, handleCancelled } from "./runner.ts";
import { makeKeyReader } from "./input.ts";
import { cursor, clearAbove, countLines } from "./ansi.ts";
import { NonTtyError, PromptCancelledError } from "./types.ts";

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export interface AutocompleteState {
  query: string;
  queryCursor: number;
  items: string[];       // currently visible (filtered or fetched) items
  index: number;         // highlighted item index, -1 = none
  loading: boolean;
  done: boolean;
  cancelled: boolean;
}

type AutocompleteAction =
  | { type: "key"; key: Key }
  | { type: "items"; items: string[] };

export function autocompleteReducer(
  state: AutocompleteState,
  action: AutocompleteAction,
): AutocompleteState {
  if (state.done || state.cancelled) return state;

  if (action.type === "items") {
    return { ...state, items: action.items, index: -1, loading: false };
  }

  const { key } = action;

  switch (key.type) {
    case "interrupt":
    case "escape":
      return { ...state, cancelled: true };

    case "enter": {
      const value = state.index >= 0 ? (state.items[state.index] ?? state.query) : state.query;
      return { ...state, query: value, done: true };
    }

    case "tab": {
      // Tab: accept highlighted item or first item
      const value = state.index >= 0
        ? (state.items[state.index] ?? state.query)
        : (state.items[0] ?? state.query);
      return { ...state, query: value, queryCursor: value.length, index: -1 };
    }

    case "up":
      return { ...state, index: Math.max(-1, state.index - 1) };

    case "down":
      return {
        ...state,
        index: Math.min(state.items.length - 1, state.index + 1),
      };

    case "char":
      return insertChar(state, key.char);

    case "backspace":
      return deleteBack(state);

    case "delete":
      return deleteForward(state);

    case "left":
      return { ...state, queryCursor: Math.max(0, state.queryCursor - 1) };

    case "right":
      return { ...state, queryCursor: Math.min(state.query.length, state.queryCursor + 1) };

    case "home":
      return { ...state, queryCursor: 0 };

    case "end":
      return { ...state, queryCursor: state.query.length };

    default:
      return state;
  }
}

function insertChar(state: AutocompleteState, char: string): AutocompleteState {
  const { query, queryCursor: pos } = state;
  const newQuery = query.slice(0, pos) + char + query.slice(pos);
  return { ...state, query: newQuery, queryCursor: pos + 1, loading: true };
}

function deleteBack(state: AutocompleteState): AutocompleteState {
  const { query, queryCursor: pos } = state;
  if (pos === 0) return state;
  const newQuery = query.slice(0, pos - 1) + query.slice(pos);
  return { ...state, query: newQuery, queryCursor: pos - 1, loading: true };
}

function deleteForward(state: AutocompleteState): AutocompleteState {
  const { query, queryCursor: pos } = state;
  if (pos === query.length) return state;
  const newQuery = query.slice(0, pos) + query.slice(pos + 1);
  return { ...state, query: newQuery, loading: true };
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const MAX_VISIBLE = 8;

export function renderAutocomplete(
  state: AutocompleteState,
  opts: AutocompletePromptOptions,
): string {
  if (state.done) {
    return `${style.green("✓")} ${style.bold(opts.message)} ${style.dim(state.query)}`;
  }
  if (state.cancelled) {
    return `${style.red("✗")} ${style.bold(opts.message)}`;
  }

  const loadingIndicator = state.loading ? style.dim(" …") : "";
  const hint = style.dim("(type to filter, ↑↓ navigate, Tab/Enter to select)");
  const inputLine = `${style.cyan("?")} ${style.bold(opts.message)} ${state.query}${loadingIndicator}`;

  const visible = state.items.slice(0, MAX_VISIBLE);
  const itemLines = visible.map((item, i) => {
    const isHighlighted = i === state.index;
    return isHighlighted
      ? `  ${style.cyan("❯")} ${style.bold(item)}`
      : `    ${item}`;
  });

  if (visible.length === 0 && !state.loading) {
    itemLines.push(`    ${style.dim("(no matches)")}`);
  } else if (state.items.length > MAX_VISIBLE) {
    itemLines.push(style.dim(`    … ${state.items.length - MAX_VISIBLE} more`));
  }

  const header = `${inputLine}  ${hint}`;
  return [header, ...itemLines].join("\n");
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** The autocomplete runner is custom (not using runPromptLoop) because it
 * interleaves key events with async fetch results. */
export async function autocomplete(opts: AutocompletePromptOptions): Promise<string> {
  if (!process.stdin.isTTY) throw new NonTtyError();

  const isStatic = Array.isArray(opts.choices);

  function filterStatic(query: string): string[] {
    const choices = opts.choices as string[];
    if (!query) return choices;
    const q = query.toLowerCase();
    return choices.filter((c) => c.toLowerCase().includes(q));
  }

  let state: AutocompleteState = {
    query: opts.default ?? "",
    queryCursor: (opts.default ?? "").length,
    items: isStatic ? filterStatic(opts.default ?? "") : [],
    index: -1,
    loading: !isStatic,
    done: false,
    cancelled: false,
  };

  let linesRendered = 0;

  const redraw = () => {
    process.stdout.write(clearAbove(linesRendered));
    const output = renderAutocomplete(state, opts);
    // Position cursor on the input line
    const inputCol = `? ${opts.message} `.length + state.queryCursor + 1;
    process.stdout.write(output + cursor.col(inputCol));
    linesRendered = countLines(output);
  };

  process.stdout.write(cursor.hide);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  const { next: nextKey, cleanup } = makeKeyReader();

  // Debounced fetch for dynamic completers
  let fetchController: AbortController | undefined;
  let fetchTimer: ReturnType<typeof setTimeout> | undefined;
  const debounceMs = opts.debounceMs ?? 150;

  const triggerFetch = (query: string) => {
    if (isStatic) {
      state = autocompleteReducer(state, { type: "items", items: filterStatic(query) });
      redraw();
      return;
    }

    clearTimeout(fetchTimer);
    fetchController?.abort();
    fetchController = new AbortController();
    const signal = fetchController.signal;

    fetchTimer = setTimeout(async () => {
      try {
        const fn = opts.choices as (q: string, s: AbortSignal) => Promise<string[]>;
        const items = await fn(query, signal);
        if (!signal.aborted) {
          state = autocompleteReducer(state, { type: "items", items });
          redraw();
          // Wake up the key reader if it's waiting — resolve with a no-op key
          // (handled by checking state.done/cancelled before the loop continues)
        }
      } catch {
        if (!signal.aborted) {
          state = autocompleteReducer(state, { type: "items", items: [] });
          redraw();
        }
      }
    }, debounceMs);
  };

  try {
    // Initial fetch
    if (!isStatic) triggerFetch(state.query);
    redraw();

    while (!state.done && !state.cancelled) {
      const key = await nextKey();
      const prevQuery = state.query;

      state = autocompleteReducer(state, { type: "key", key });

      // If query changed, trigger a new fetch
      if (state.query !== prevQuery) {
        triggerFetch(state.query);
      }

      if (!state.done && !state.cancelled) {
        redraw();
      }
    }
  } finally {
    clearTimeout(fetchTimer);
    fetchController?.abort();
    cleanup();
    process.stdout.write(clearAbove(linesRendered));
    process.stdout.write(cursor.show);
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }

  if (state.cancelled) {
    process.stdout.write(renderAutocomplete({ ...state, cancelled: true }, opts) + "\n");
    throw new PromptCancelledError();
  }

  process.stdout.write(renderAutocomplete(state, opts) + "\n");
  return state.query;
}
