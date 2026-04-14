import type { Key, AutocompletePromptOptions } from "./types.ts";
import { choiceLabel, choiceValue } from "../parser/types.ts";
import type { CompletionChoice } from "../parser/types.ts";
import { style } from "./ansi.ts";
import { makeKeyReader } from "./input.ts";
import { cursor, clearAbove, countLines } from "./ansi.ts";
import { NonTtyError, PromptCancelledError } from "./types.ts";

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export interface AutocompleteState {
  query: string; // text shown in the input field (label of selected item, or typed text)
  queryCursor: number;
  items: CompletionChoice[]; // currently visible (filtered or fetched) items
  index: number; // highlighted item index, -1 = none
  /**
   * The value to return when done. Set when the user selects a choice (which
   * may have a different value from its label). Undefined means fall back to
   * query as both label and value (plain-string / free-text path).
   */
  selectedValue: string | undefined;
  loading: boolean;
  done: boolean;
  cancelled: boolean;
  /** The default value — used as fallback on Enter when items is empty and query is "". */
  defaultValue?: string;
}

type AutocompleteAction = { type: "key"; key: Key } | { type: "items"; items: CompletionChoice[] };

export function autocompleteReducer(
  state: AutocompleteState,
  action: AutocompleteAction,
): AutocompleteState {
  if (state.done || state.cancelled) return state;

  if (action.type === "items") {
    // Snap selection to first item so Enter always picks the top match
    return {
      ...state,
      items: action.items,
      index: action.items.length > 0 ? 0 : -1,
      loading: false,
    };
  }

  const { key } = action;

  switch (key.type) {
    case "interrupt":
    case "escape":
      return { ...state, cancelled: true };

    case "enter": {
      // Explicit selection > first item > typed query > default (when no items match)
      const selected = state.index >= 0 ? state.items[state.index] : state.items[0];
      if (selected !== undefined) {
        const label = choiceLabel(selected);
        const value = choiceValue(selected);
        return { ...state, query: label, selectedValue: value, done: true };
      }
      // No item — use already-selected value from Tab, or the typed query, or default
      const fallback = state.selectedValue ?? (state.query || (state.defaultValue ?? ""));
      return { ...state, query: fallback, selectedValue: fallback, done: true };
    }

    case "tab": {
      // Tab: accept highlighted item or first item — fill in label, record value
      const choice =
        state.index >= 0 ? (state.items[state.index] ?? state.items[0]) : state.items[0];
      if (choice !== undefined) {
        const label = choiceLabel(choice);
        const value = choiceValue(choice);
        return {
          ...state,
          query: label,
          queryCursor: label.length,
          selectedValue: value,
          index: -1,
        };
      }
      return state;
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
  // Clear selection while items refresh so the stale highlight doesn't linger
  return {
    ...state,
    query: newQuery,
    queryCursor: pos + 1,
    selectedValue: undefined,
    index: -1,
    loading: true,
  };
}

function deleteBack(state: AutocompleteState): AutocompleteState {
  const { query, queryCursor: pos } = state;
  if (pos === 0) return state;
  const newQuery = query.slice(0, pos - 1) + query.slice(pos);
  return {
    ...state,
    query: newQuery,
    queryCursor: pos - 1,
    selectedValue: undefined,
    index: -1,
    loading: true,
  };
}

function deleteForward(state: AutocompleteState): AutocompleteState {
  const { query, queryCursor: pos } = state;
  if (pos === query.length) return state;
  const newQuery = query.slice(0, pos) + query.slice(pos + 1);
  return { ...state, query: newQuery, selectedValue: undefined, index: -1, loading: true };
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const MAX_VISIBLE = 8;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function renderAutocomplete(
  state: AutocompleteState,
  opts: AutocompletePromptOptions,
  /** Current spinner frame index — incremented externally while loading. */
  spinnerFrame = 0,
): string {
  if (state.done) {
    return `${style.green("✓")} ${style.bold(opts.message)} ${style.dim(state.query)}`;
  }
  if (state.cancelled) {
    return `${style.red("✗")} ${style.bold(opts.message)}`;
  }

  // While loading the spinner replaces the ? so the prefix position is stable.
  const prefix = state.loading
    ? style.cyan(SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]!)
    : style.cyan("?");

  // Input line: keep it short so it never wraps on typical terminals.
  // The hint lives on its own line below so the two don't combine to >80 chars.
  // When query is empty and a default exists, show the default as a dim placeholder.
  const queryDisplay = state.query || (opts.default ? style.dim(opts.default) : "");
  const inputLine = `${prefix} ${style.bold(opts.message)} ${queryDisplay}`;
  const hintLine = `  ${style.dim("(type to filter, ↑↓ navigate, Tab/Enter to select)")}`;

  const visible = state.items.slice(0, MAX_VISIBLE);
  const itemLines = visible.map((item, i) => {
    const label = choiceLabel(item);
    const isHighlighted = i === state.index;
    return isHighlighted ? `  ${style.cyan("❯")} ${style.bold(label)}` : `    ${label}`;
  });

  if (visible.length === 0 && !state.loading) {
    itemLines.push(`    ${style.dim("(no matches)")}`);
  } else if (state.items.length > MAX_VISIBLE) {
    itemLines.push(style.dim(`    … ${state.items.length - MAX_VISIBLE} more`));
  }

  return [inputLine, hintLine, ...itemLines].join("\n");
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** The autocomplete runner is custom (not using runPromptLoop) because it
 * interleaves key events with async fetch results. */
export async function autocomplete(opts: AutocompletePromptOptions): Promise<string> {
  if (!process.stdin.isTTY) throw new NonTtyError();

  const isStatic = Array.isArray(opts.choices);

  /** Float the default value (matched by value) to index 0 so it's always visible and pre-selected. */
  function floatDefault(items: CompletionChoice[]): CompletionChoice[] {
    if (!opts.default) return items;
    const idx = items.findIndex((c) => choiceValue(c) === opts.default);
    if (idx <= 0) return items;
    return [items[idx]!, ...items.slice(0, idx), ...items.slice(idx + 1)];
  }

  function filterStatic(query: string): CompletionChoice[] {
    const choices = opts.choices as CompletionChoice[];
    if (!query) return floatDefault(choices);
    const q = query.toLowerCase();
    return choices.filter((c) => choiceLabel(c).toLowerCase().includes(q));
  }

  const initialItems = isStatic ? filterStatic("") : [];

  let state: AutocompleteState = {
    query: "",
    queryCursor: 0,
    items: initialItems,
    index: initialItems.length > 0 ? 0 : -1,
    selectedValue: undefined,
    loading: !isStatic,
    done: false,
    cancelled: false,
    defaultValue: opts.default,
  };

  // ---------------------------------------------------------------------------
  // Spinner animation (runs while state.loading === true)
  // ---------------------------------------------------------------------------

  let spinnerFrame = 0;
  let spinnerTimer: ReturnType<typeof setInterval> | undefined;

  function startSpinner() {
    if (spinnerTimer) return;
    spinnerTimer = setInterval(() => {
      if (!state.loading) {
        clearInterval(spinnerTimer!);
        spinnerTimer = undefined;
        return;
      }
      spinnerFrame++;
      redraw();
    }, 80);
  }

  // ---------------------------------------------------------------------------
  // Redraw
  //
  // Key invariant: after every redraw the cursor sits on the INPUT line (line 1
  // of the prompt block) at column `inputCol`.  Setting linesRendered = 0 then
  // means that the next clearAbove(0) = "\r\x1b[J" always erases from line 1
  // to end-of-screen, no matter how many item lines are currently visible.
  //
  // This avoids the double-render bug: previously, linesRendered tracked the
  // number of \n chars in the output, and cursor.col() left the cursor on the
  // LAST item line.  When the loading state rendered as one \n-less line the
  // cursor ended up at column inputCol on the prompt line — but if that line
  // soft-wrapped (long hint + spinner > terminal width), the cursor was really
  // on the wrapped second line.  clearAbove(0) would then erase from the
  // second line only, leaving the first wrapped line visible as a ghost prompt.
  // ---------------------------------------------------------------------------

  let linesRendered = -1;

  const redraw = () => {
    if (linesRendered >= 0) process.stdout.write(clearAbove(linesRendered));

    const output = renderAutocomplete(state, opts, spinnerFrame);
    const nLines = countLines(output); // number of \n — equals (total lines - 1)
    const inputCol = `? ${opts.message} `.length + state.queryCursor + 1;

    // After writing `output` the cursor is on the last line (line nLines+1).
    // Move it back up to the input line (line 1) so the next clearAbove(0)
    // correctly erases everything from line 1 downward.
    const moveUp = nLines > 0 ? cursor.up(nLines) : "";
    process.stdout.write(output + moveUp + cursor.col(inputCol));

    // Cursor is now on line 1 — clearAbove(0) is always sufficient.
    linesRendered = 0;
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

    // Animate the spinner while the fetch is in-flight
    startSpinner();

    fetchTimer = setTimeout(async () => {
      try {
        const fn = opts.choices as (q: string, s: AbortSignal) => Promise<CompletionChoice[]>;
        let items = await fn(query, signal);
        if (!signal.aborted) {
          // Float default to top when no query is active, same as static behaviour
          if (!query) items = floatDefault(items);
          state = autocompleteReducer(state, { type: "items", items });
          redraw();
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
    clearInterval(spinnerTimer);
    fetchController?.abort();
    cleanup();
    if (linesRendered >= 0) process.stdout.write(clearAbove(linesRendered));
    process.stdout.write(cursor.show);
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }

  if (state.cancelled) {
    process.stdout.write(renderAutocomplete({ ...state, cancelled: true }, opts) + "\n");
    throw new PromptCancelledError();
  }

  process.stdout.write(renderAutocomplete(state, opts) + "\n");
  return state.selectedValue ?? state.query;
}
