import type { Key, AutocompletePromptOptions } from "./types.ts";
import { style } from "./ansi.ts";
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
    // Snap selection to first item so Enter always picks the top match
    return { ...state, items: action.items, index: action.items.length > 0 ? 0 : -1, loading: false };
  }

  const { key } = action;

  switch (key.type) {
    case "interrupt":
    case "escape":
      return { ...state, cancelled: true };

    case "enter": {
      // Explicit selection > first item > typed query (when no items match)
      const value =
        state.index >= 0
          ? (state.items[state.index] ?? state.query)
          : (state.items[0] ?? state.query);
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
  // Clear selection while items refresh so the stale highlight doesn't linger
  return { ...state, query: newQuery, queryCursor: pos + 1, index: -1, loading: true };
}

function deleteBack(state: AutocompleteState): AutocompleteState {
  const { query, queryCursor: pos } = state;
  if (pos === 0) return state;
  const newQuery = query.slice(0, pos - 1) + query.slice(pos);
  return { ...state, query: newQuery, queryCursor: pos - 1, index: -1, loading: true };
}

function deleteForward(state: AutocompleteState): AutocompleteState {
  const { query, queryCursor: pos } = state;
  if (pos === query.length) return state;
  const newQuery = query.slice(0, pos) + query.slice(pos + 1);
  return { ...state, query: newQuery, index: -1, loading: true };
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

  const spinnerChar = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]!;
  const loadingIndicator = state.loading ? ` ${style.cyan(spinnerChar)}` : "";

  // Input line: keep it short so it never wraps on typical terminals.
  // The hint lives on its own line below so the two don't combine to >80 chars.
  const inputLine = `${style.cyan("?")} ${style.bold(opts.message)} ${state.query}${loadingIndicator}`;
  const hintLine  = `  ${style.dim("(type to filter, ↑↓ navigate, Tab/Enter to select)")}`;

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

  function filterStatic(query: string): string[] {
    const choices = opts.choices as string[];
    if (!query) return choices;
    const q = query.toLowerCase();
    return choices.filter((c) => c.toLowerCase().includes(q));
  }

  const initialItems = isStatic ? filterStatic(opts.default ?? "") : [];
  const initialIndex = (() => {
    if (initialItems.length === 0) return -1;
    if (opts.default) {
      const exact = initialItems.indexOf(opts.default);
      if (exact !== -1) return exact;
    }
    return 0;
  })();

  let state: AutocompleteState = {
    query: opts.default ?? "",
    queryCursor: (opts.default ?? "").length,
    items: initialItems,
    index: initialIndex,
    loading: !isStatic,
    done: false,
    cancelled: false,
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
        const fn = opts.choices as (q: string, s: AbortSignal) => Promise<string[]>;
        const items = await fn(query, signal);
        if (!signal.aborted) {
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
  return state.query;
}
