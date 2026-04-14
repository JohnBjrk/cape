import { describe, it, expect } from "bun:test";
import { textReducer, type TextState } from "./text.ts";
import { selectReducer, renderSelect, type SelectState } from "./select.ts";
import { confirmReducer, type ConfirmState } from "./confirm.ts";
import { multiSelectReducer, renderMultiSelect, type MultiSelectState } from "./multi-select.ts";
import { autocompleteReducer, renderAutocomplete, type AutocompleteState } from "./autocomplete.ts";
import type {
  Key,
  SelectPromptOptions,
  MultiSelectPromptOptions,
  AutocompletePromptOptions,
} from "./types.ts";
import type { CompletionChoice } from "../parser/types.ts";
import { fromSchema, promptedToArgv } from "./from-schema.ts";

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const char = (c: string): Key => ({ type: "char", char: c });
const key = (type: Key["type"]): Key => ({ type }) as Key;

// ---------------------------------------------------------------------------
// textReducer
// ---------------------------------------------------------------------------

describe("textReducer", () => {
  const base: TextState = {
    value: "",
    cursor: 0,
    isPlaceholder: false,
    error: undefined,
    done: false,
    cancelled: false,
  };

  it("inserts character at cursor", () => {
    const s = textReducer(base, char("h"));
    expect(s.value).toBe("h");
    expect(s.cursor).toBe(1);
  });

  it("inserts character in the middle", () => {
    const s0 = { ...base, value: "helo", cursor: 3 };
    const s1 = textReducer(s0, char("l"));
    expect(s1.value).toBe("hello");
    expect(s1.cursor).toBe(4);
  });

  it("backspace removes character before cursor", () => {
    const s0 = { ...base, value: "hello", cursor: 5 };
    const s1 = textReducer(s0, key("backspace"));
    expect(s1.value).toBe("hell");
    expect(s1.cursor).toBe(4);
  });

  it("backspace at cursor=0 is a no-op", () => {
    const s = textReducer(base, key("backspace"));
    expect(s.value).toBe("");
    expect(s.cursor).toBe(0);
  });

  it("delete removes character after cursor", () => {
    const s0 = { ...base, value: "hello", cursor: 2 };
    const s1 = textReducer(s0, key("delete"));
    expect(s1.value).toBe("helo");
    expect(s1.cursor).toBe(2);
  });

  it("delete at end is a no-op", () => {
    const s0 = { ...base, value: "hello", cursor: 5 };
    const s = textReducer(s0, key("delete"));
    expect(s.value).toBe("hello");
  });

  it("left moves cursor back", () => {
    const s0 = { ...base, cursor: 3 };
    expect(textReducer(s0, key("left")).cursor).toBe(2);
  });

  it("left at 0 is a no-op", () => {
    expect(textReducer(base, key("left")).cursor).toBe(0);
  });

  it("right moves cursor forward", () => {
    const s0 = { ...base, value: "hi", cursor: 0 };
    expect(textReducer(s0, key("right")).cursor).toBe(1);
  });

  it("right at end is a no-op", () => {
    const s0 = { ...base, value: "hi", cursor: 2 };
    expect(textReducer(s0, key("right")).cursor).toBe(2);
  });

  it("home moves cursor to 0", () => {
    const s0 = { ...base, value: "hello", cursor: 3 };
    expect(textReducer(s0, key("home")).cursor).toBe(0);
  });

  it("end moves cursor to value length", () => {
    const s0 = { ...base, value: "hello", cursor: 0 };
    expect(textReducer(s0, key("end")).cursor).toBe(5);
  });

  it("enter sets done = true", () => {
    const s = textReducer({ ...base, value: "hello" }, key("enter"));
    expect(s.done).toBe(true);
    expect(s.cancelled).toBe(false);
  });

  it("enter with validate sets error and does not set done", () => {
    const validate = (v: string) => (v.length < 3 ? "too short" : undefined);
    const s = textReducer({ ...base, value: "hi" }, key("enter"), validate);
    expect(s.done).toBe(false);
    expect(s.error).toBe("too short");
  });

  it("enter with passing validate sets done", () => {
    const validate = (v: string) => (v.length < 3 ? "too short" : undefined);
    const s = textReducer({ ...base, value: "hello" }, key("enter"), validate);
    expect(s.done).toBe(true);
    expect(s.error).toBeUndefined();
  });

  it("escape sets cancelled = true", () => {
    const s = textReducer(base, key("escape"));
    expect(s.cancelled).toBe(true);
    expect(s.done).toBe(false);
  });

  it("interrupt sets cancelled = true", () => {
    const s = textReducer(base, key("interrupt"));
    expect(s.cancelled).toBe(true);
  });

  it("does not modify state after done", () => {
    const done: TextState = { ...base, value: "hi", done: true, cursor: 2 };
    const s = textReducer(done, char("x"));
    expect(s.value).toBe("hi");
  });

  describe("placeholder (default value) behaviour", () => {
    const withDefault: TextState = {
      value: "World",
      cursor: 5,
      isPlaceholder: true,
      error: undefined,
      done: false,
      cancelled: false,
    };

    it("first char replaces the placeholder entirely", () => {
      const s = textReducer(withDefault, char("J"));
      expect(s.value).toBe("J");
      expect(s.cursor).toBe(1);
      expect(s.isPlaceholder).toBe(false);
    });

    it("backspace clears the placeholder", () => {
      const s = textReducer(withDefault, key("backspace"));
      expect(s.value).toBe("");
      expect(s.cursor).toBe(0);
      expect(s.isPlaceholder).toBe(false);
    });

    it("delete clears the placeholder", () => {
      const s = textReducer(withDefault, key("delete"));
      expect(s.value).toBe("");
      expect(s.isPlaceholder).toBe(false);
    });

    it("arrow key switches to edit mode without clearing", () => {
      const s = textReducer(withDefault, key("left"));
      expect(s.value).toBe("World");
      expect(s.isPlaceholder).toBe(false);
      expect(s.cursor).toBe(4);
    });

    it("Enter on placeholder accepts the default", () => {
      const s = textReducer(withDefault, key("enter"));
      expect(s.done).toBe(true);
      expect(s.value).toBe("World");
    });
  });
});

// ---------------------------------------------------------------------------
// selectReducer
// ---------------------------------------------------------------------------

describe("selectReducer", () => {
  const choices = ["apple", "banana", "cherry"];
  const base: SelectState = { choices, index: 0, done: false, cancelled: false };

  it("down moves index forward", () => {
    expect(selectReducer(base, key("down")).index).toBe(1);
  });

  it("down wraps around to 0 at end", () => {
    const s = selectReducer({ ...base, index: 2 }, key("down"));
    expect(s.index).toBe(0);
  });

  it("up moves index backward", () => {
    const s = selectReducer({ ...base, index: 2 }, key("up"));
    expect(s.index).toBe(1);
  });

  it("up wraps around to last at beginning", () => {
    const s = selectReducer(base, key("up"));
    expect(s.index).toBe(2);
  });

  it("home jumps to first item", () => {
    expect(selectReducer({ ...base, index: 2 }, key("home")).index).toBe(0);
  });

  it("end jumps to last item", () => {
    expect(selectReducer(base, key("end")).index).toBe(2);
  });

  it("enter sets done = true", () => {
    const s = selectReducer(base, key("enter"));
    expect(s.done).toBe(true);
  });

  it("escape sets cancelled = true", () => {
    expect(selectReducer(base, key("escape")).cancelled).toBe(true);
  });

  it("interrupt sets cancelled = true", () => {
    expect(selectReducer(base, key("interrupt")).cancelled).toBe(true);
  });

  it("typing a char jumps to first matching item", () => {
    const s = selectReducer(base, char("b"));
    expect(s.index).toBe(1); // "banana"
  });

  it("does not modify state after done", () => {
    const done: SelectState = { ...base, done: true };
    expect(selectReducer(done, key("down")).index).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// confirmReducer
// ---------------------------------------------------------------------------

describe("confirmReducer", () => {
  const base: ConfirmState = { answer: undefined, done: false, cancelled: false };

  it("'y' sets answer = true and done", () => {
    const s = confirmReducer(base, char("y"), false);
    expect(s.answer).toBe(true);
    expect(s.done).toBe(true);
  });

  it("'Y' sets answer = true and done", () => {
    const s = confirmReducer(base, char("Y"), false);
    expect(s.answer).toBe(true);
    expect(s.done).toBe(true);
  });

  it("'n' sets answer = false and done", () => {
    const s = confirmReducer(base, char("n"), true);
    expect(s.answer).toBe(false);
    expect(s.done).toBe(true);
  });

  it("Enter with default=true accepts true", () => {
    const s = confirmReducer(base, key("enter"), true);
    expect(s.answer).toBe(true);
    expect(s.done).toBe(true);
  });

  it("Enter with default=false accepts false", () => {
    const s = confirmReducer(base, key("enter"), false);
    expect(s.answer).toBe(false);
    expect(s.done).toBe(true);
  });

  it("other chars do nothing", () => {
    const s = confirmReducer(base, char("x"), false);
    expect(s.done).toBe(false);
    expect(s.answer).toBeUndefined();
  });

  it("escape cancels", () => {
    expect(confirmReducer(base, key("escape"), false).cancelled).toBe(true);
  });

  it("interrupt cancels", () => {
    expect(confirmReducer(base, key("interrupt"), false).cancelled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// multiSelectReducer
// ---------------------------------------------------------------------------

describe("multiSelectReducer", () => {
  const choices = ["alpha", "beta", "gamma"];
  const base: MultiSelectState = {
    choices,
    index: 0,
    checked: new Set(),
    done: false,
    cancelled: false,
  };

  it("space toggles the current item on", () => {
    const s = multiSelectReducer(base, char(" "));
    expect(s.checked.has(0)).toBe(true);
  });

  it("space toggles the current item off", () => {
    const s0 = { ...base, checked: new Set([0]) };
    const s1 = multiSelectReducer(s0, char(" "));
    expect(s1.checked.has(0)).toBe(false);
  });

  it("down moves index", () => {
    expect(multiSelectReducer(base, key("down")).index).toBe(1);
  });

  it("down wraps around", () => {
    expect(multiSelectReducer({ ...base, index: 2 }, key("down")).index).toBe(0);
  });

  it("up moves index", () => {
    expect(multiSelectReducer({ ...base, index: 2 }, key("up")).index).toBe(1);
  });

  it("'a' selects all when none selected", () => {
    const s = multiSelectReducer(base, char("a"));
    expect(s.checked.size).toBe(3);
  });

  it("'a' deselects all when all selected", () => {
    const s0 = { ...base, checked: new Set([0, 1, 2]) };
    const s1 = multiSelectReducer(s0, char("a"));
    expect(s1.checked.size).toBe(0);
  });

  it("enter sets done", () => {
    expect(multiSelectReducer(base, key("enter")).done).toBe(true);
  });

  it("escape cancels", () => {
    expect(multiSelectReducer(base, key("escape")).cancelled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// autocompleteReducer
// ---------------------------------------------------------------------------

describe("autocompleteReducer", () => {
  const base: AutocompleteState = {
    query: "",
    queryCursor: 0,
    items: ["Alice", "Bob", "Charlie"],
    index: -1,
    selectedValue: undefined,
    loading: false,
    done: false,
    cancelled: false,
  };

  it("typing chars updates query, sets loading, and clears index", () => {
    const s = autocompleteReducer({ ...base, index: 1 }, { type: "key", key: char("a") });
    expect(s.query).toBe("a");
    expect(s.queryCursor).toBe(1);
    expect(s.loading).toBe(true);
    expect(s.index).toBe(-1);
  });

  it("items action updates items, clears loading, and snaps index to 0", () => {
    const s = autocompleteReducer({ ...base, loading: true }, { type: "items", items: ["Alice"] });
    expect(s.items).toEqual(["Alice"]);
    expect(s.loading).toBe(false);
    expect(s.index).toBe(0);
  });

  it("items action sets index to -1 when items are empty", () => {
    const s = autocompleteReducer({ ...base, loading: true }, { type: "items", items: [] });
    expect(s.index).toBe(-1);
  });

  it("down moves index forward, capped at items length - 1", () => {
    const s = autocompleteReducer({ ...base, index: -1 }, { type: "key", key: key("down") });
    expect(s.index).toBe(0);

    const s2 = autocompleteReducer({ ...base, index: 2 }, { type: "key", key: key("down") });
    expect(s2.index).toBe(2); // capped
  });

  it("up moves index backward, capped at -1", () => {
    const s = autocompleteReducer({ ...base, index: 0 }, { type: "key", key: key("up") });
    expect(s.index).toBe(-1);
  });

  it("tab selects highlighted item and updates query", () => {
    const s = autocompleteReducer({ ...base, index: 1 }, { type: "key", key: key("tab") });
    expect(s.query).toBe("Bob");
    expect(s.queryCursor).toBe(3);
    expect(s.index).toBe(-1);
  });

  it("tab with no highlight selects first item", () => {
    const s = autocompleteReducer(base, { type: "key", key: key("tab") });
    expect(s.query).toBe("Alice");
  });

  it("enter with highlight sets done with highlighted value", () => {
    const s = autocompleteReducer({ ...base, index: 2 }, { type: "key", key: key("enter") });
    expect(s.done).toBe(true);
    expect(s.query).toBe("Charlie");
  });

  it("enter with no highlight accepts the first item when items are present", () => {
    const s = autocompleteReducer(base, { type: "key", key: key("enter") });
    expect(s.done).toBe(true);
    expect(s.query).toBe("Alice");
  });

  it("enter with no highlight and no items accepts the typed query", () => {
    const s = autocompleteReducer(
      { ...base, items: [], query: "custom" },
      { type: "key", key: key("enter") },
    );
    expect(s.done).toBe(true);
    expect(s.query).toBe("custom");
  });

  it("escape cancels", () => {
    expect(autocompleteReducer(base, { type: "key", key: key("escape") }).cancelled).toBe(true);
  });

  it("backspace deletes character before cursor", () => {
    const s0 = { ...base, query: "hello", queryCursor: 5 };
    const s1 = autocompleteReducer(s0, { type: "key", key: key("backspace") });
    expect(s1.query).toBe("hell");
    expect(s1.queryCursor).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// promptedToArgv
// ---------------------------------------------------------------------------

describe("promptedToArgv", () => {
  it("converts string values to --flag value pairs", () => {
    expect(promptedToArgv({ name: "Alice" })).toEqual(["--name", "Alice"]);
  });

  it("converts number values to --flag value pairs", () => {
    expect(promptedToArgv({ count: 3 })).toEqual(["--count", "3"]);
  });

  it("converts boolean true to bare --flag", () => {
    expect(promptedToArgv({ confirm: true })).toEqual(["--confirm"]);
  });

  it("omits boolean false", () => {
    expect(promptedToArgv({ confirm: false })).toEqual([]);
  });

  it("expands array values to repeated --flag value pairs", () => {
    expect(promptedToArgv({ tag: ["a", "b"] })).toEqual(["--tag", "a", "--tag", "b"]);
  });

  it("skips undefined and null", () => {
    expect(promptedToArgv({ a: undefined, b: null })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// fromSchema — prompt boolean
// ---------------------------------------------------------------------------

describe("fromSchema — prompt boolean", () => {
  it("skips boolean flags without prompt: true", async () => {
    const result = await fromSchema({ flags: { verbose: { type: "boolean" } } }, new Set<string>());
    expect(result).toEqual({});
  });

  it("skips prompt boolean that is already provided", async () => {
    const result = await fromSchema(
      { flags: { confirm: { type: "boolean", prompt: true } } },
      new Set<string>(["confirm"]),
    );
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// resolve — prompt boolean defaulting in skipRequired mode
// ---------------------------------------------------------------------------

describe("resolve — prompt boolean skipRequired mode", () => {
  it("leaves prompt boolean undefined in skipRequired mode", async () => {
    const { resolve } = await import("../parser/resolve.ts");
    const { tokenize } = await import("../parser/tokenize.ts");
    const schema = { flags: { confirm: { type: "boolean" as const, prompt: true } } };
    const result = resolve(tokenize([]), schema, { skipRequired: true });
    expect(result.flags["confirm"]).toBeUndefined();
  });

  it("defaults prompt boolean to false in full parse", async () => {
    const { resolve } = await import("../parser/resolve.ts");
    const { tokenize } = await import("../parser/tokenize.ts");
    const schema = { flags: { confirm: { type: "boolean" as const, prompt: true } } };
    const result = resolve(tokenize([]), schema);
    expect(result.flags["confirm"]).toBe(false);
  });

  it("regular boolean still defaults to false in skipRequired mode", async () => {
    const { resolve } = await import("../parser/resolve.ts");
    const { tokenize } = await import("../parser/tokenize.ts");
    const schema = { flags: { verbose: { type: "boolean" as const } } };
    const result = resolve(tokenize([]), schema, { skipRequired: true });
    expect(result.flags["verbose"]).toBe(false);
  });

  it("required boolean without prompt: true still defaults to false", async () => {
    const { resolve } = await import("../parser/resolve.ts");
    const { tokenize } = await import("../parser/tokenize.ts");
    const schema = { flags: { confirm: { type: "boolean" as const, required: true } } };
    const result = resolve(tokenize([]), schema, { skipRequired: true });
    expect(result.flags["confirm"]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// renderSelect
// ---------------------------------------------------------------------------

describe("renderSelect", () => {
  const opts: SelectPromptOptions = { message: "Pick one", choices: ["apple", "banana", "cherry"] };
  const base: SelectState = { choices: opts.choices, index: 0, done: false, cancelled: false };

  it("shows question mark, message, hint, and all choice labels", () => {
    const out = stripAnsi(renderSelect(base, opts));
    expect(out).toContain("? Pick one");
    expect(out).toContain("apple");
    expect(out).toContain("banana");
    expect(out).toContain("cherry");
  });

  it("marks the current index with ❯ and leaves others unmarked", () => {
    const out = stripAnsi(renderSelect({ ...base, index: 1 }, opts));
    const lines = out.split("\n");
    expect(lines.some((l) => l.includes("❯") && l.includes("banana"))).toBe(true);
    expect(lines.some((l) => !l.includes("❯") && l.includes("apple"))).toBe(true);
  });

  it("done state shows ✓ and the selected label", () => {
    const out = stripAnsi(renderSelect({ ...base, index: 2, done: true }, opts));
    expect(out).toContain("✓");
    expect(out).toContain("cherry");
    expect(out).not.toContain("?");
  });

  it("cancelled state shows ✗", () => {
    const out = stripAnsi(renderSelect({ ...base, cancelled: true }, opts));
    expect(out).toContain("✗");
    expect(out).not.toContain("?");
  });

  it("displays label (not value) for label/value choices while idle", () => {
    const choices: CompletionChoice[] = [
      { label: "Production", value: "prod" },
      { label: "Staging", value: "stage" },
    ];
    const opts2: SelectPromptOptions = { message: "Env", choices };
    const out = stripAnsi(
      renderSelect({ choices, index: 0, done: false, cancelled: false }, opts2),
    );
    expect(out).toContain("Production");
    expect(out).toContain("Staging");
    expect(out).not.toContain("prod");
    expect(out).not.toContain("stage");
  });

  it("done state shows label (not value) for label/value choices", () => {
    const choices: CompletionChoice[] = [
      { label: "Production", value: "prod" },
      { label: "Staging", value: "stage" },
    ];
    const opts2: SelectPromptOptions = { message: "Env", choices };
    const out = stripAnsi(renderSelect({ choices, index: 0, done: true, cancelled: false }, opts2));
    expect(out).toContain("Production");
    expect(out).not.toContain("prod");
  });
});

// ---------------------------------------------------------------------------
// selectReducer — label/value choices
// ---------------------------------------------------------------------------

describe("selectReducer — label/value choices", () => {
  const choices: CompletionChoice[] = [
    { label: "Production", value: "prod" },
    { label: "Staging", value: "stage" },
    { label: "Development", value: "dev" },
  ];
  const base: SelectState = { choices, index: 0, done: false, cancelled: false };

  it("char jump matches on label, not value", () => {
    // 's' should match 'Staging' (label), not 'stage' (value)
    expect(selectReducer(base, char("s")).index).toBe(1);
  });

  it("char jump case-insensitive on label", () => {
    expect(selectReducer(base, char("d")).index).toBe(2); // Development
  });

  it("enter sets done at current index for label/value choices", () => {
    const s = selectReducer({ ...base, index: 1 }, key("enter"));
    expect(s.done).toBe(true);
    expect(s.index).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// renderMultiSelect
// ---------------------------------------------------------------------------

describe("renderMultiSelect", () => {
  const opts: MultiSelectPromptOptions = {
    message: "Pick flavours",
    choices: ["vanilla", "chocolate", "strawberry"],
  };
  const base: MultiSelectState = {
    choices: opts.choices,
    index: 0,
    checked: new Set(),
    done: false,
    cancelled: false,
  };

  it("shows all choice labels", () => {
    const out = stripAnsi(renderMultiSelect(base, opts));
    expect(out).toContain("vanilla");
    expect(out).toContain("chocolate");
    expect(out).toContain("strawberry");
  });

  it("shows checked marker for checked items", () => {
    const out = stripAnsi(renderMultiSelect({ ...base, checked: new Set([1]) }, opts));
    const lines = out.split("\n");
    expect(lines.some((l) => l.includes("◉") && l.includes("chocolate"))).toBe(true);
    expect(lines.some((l) => l.includes("○") && l.includes("vanilla"))).toBe(true);
  });

  it("done state shows ✓ and selected labels joined by comma", () => {
    const out = stripAnsi(
      renderMultiSelect({ ...base, checked: new Set([0, 2]), done: true }, opts),
    );
    expect(out).toContain("✓");
    expect(out).toContain("vanilla");
    expect(out).toContain("strawberry");
    expect(out).not.toContain("chocolate");
  });

  it("done with nothing checked shows (none)", () => {
    const out = stripAnsi(renderMultiSelect({ ...base, done: true }, opts));
    expect(out).toContain("(none)");
  });

  it("cancelled state shows ✗", () => {
    const out = stripAnsi(renderMultiSelect({ ...base, cancelled: true }, opts));
    expect(out).toContain("✗");
  });

  it("displays labels (not values) for label/value choices", () => {
    const choices: CompletionChoice[] = [
      { label: "Vanilla Bean", value: "vanilla" },
      { label: "Dark Chocolate", value: "choc" },
    ];
    const opts2: MultiSelectPromptOptions = { message: "Pick", choices };
    const state: MultiSelectState = {
      choices,
      index: 0,
      checked: new Set([0, 1]),
      done: true,
      cancelled: false,
    };
    const out = stripAnsi(renderMultiSelect(state, opts2));
    expect(out).toContain("Vanilla Bean");
    expect(out).toContain("Dark Chocolate");
    expect(out).not.toContain('"vanilla"');
    expect(out).not.toContain('"choc"');
  });
});

// ---------------------------------------------------------------------------
// renderAutocomplete
// ---------------------------------------------------------------------------

describe("renderAutocomplete", () => {
  const opts: AutocompletePromptOptions = {
    message: "Search",
    choices: ["Alice", "Bob", "Charlie"],
  };
  const base: AutocompleteState = {
    query: "",
    queryCursor: 0,
    items: ["Alice", "Bob", "Charlie"],
    index: 0,
    selectedValue: undefined,
    loading: false,
    done: false,
    cancelled: false,
  };

  it("shows question mark, message, hint, and items", () => {
    const out = stripAnsi(renderAutocomplete(base, opts));
    expect(out).toContain("? Search");
    expect(out).toContain("Alice");
    expect(out).toContain("Bob");
  });

  it("highlights the item at index with ❯", () => {
    const out = stripAnsi(renderAutocomplete({ ...base, index: 1 }, opts));
    const lines = out.split("\n");
    expect(lines.some((l) => l.includes("❯") && l.includes("Bob"))).toBe(true);
    expect(lines.some((l) => !l.includes("❯") && l.includes("Alice"))).toBe(true);
  });

  it("shows (no matches) when items is empty and not loading", () => {
    const out = stripAnsi(renderAutocomplete({ ...base, items: [], index: -1 }, opts));
    expect(out).toContain("(no matches)");
  });

  it("shows spinner frame instead of ? when loading", () => {
    const out = stripAnsi(renderAutocomplete({ ...base, loading: true }, opts, 0));
    expect(out).not.toContain("?");
  });

  it("done state shows ✓ and the query (selected label)", () => {
    const out = stripAnsi(renderAutocomplete({ ...base, query: "Alice", done: true }, opts));
    expect(out).toContain("✓");
    expect(out).toContain("Alice");
    expect(out).not.toContain("?");
  });

  it("cancelled state shows ✗", () => {
    const out = stripAnsi(renderAutocomplete({ ...base, cancelled: true }, opts));
    expect(out).toContain("✗");
  });

  it("displays item labels (not values) for label/value choices", () => {
    const choices: CompletionChoice[] = [
      { label: "Production", value: "prod" },
      { label: "Staging", value: "stage" },
    ];
    const opts2: AutocompletePromptOptions = { message: "Env", choices };
    const state: AutocompleteState = { ...base, items: choices };
    const out = stripAnsi(renderAutocomplete(state, opts2));
    expect(out).toContain("Production");
    expect(out).toContain("Staging");
    expect(out).not.toContain("prod");
    expect(out).not.toContain("stage");
  });
});

// ---------------------------------------------------------------------------
// autocompleteReducer — label/value choices
// ---------------------------------------------------------------------------

describe("autocompleteReducer — label/value choices", () => {
  const items: CompletionChoice[] = [
    { label: "Production", value: "prod" },
    { label: "Staging", value: "stage" },
  ];
  const base: AutocompleteState = {
    query: "",
    queryCursor: 0,
    items,
    index: 0,
    selectedValue: undefined,
    loading: false,
    done: false,
    cancelled: false,
  };

  it("tab sets query to label and selectedValue to value", () => {
    const s = autocompleteReducer({ ...base, index: 0 }, { type: "key", key: key("tab") });
    expect(s.query).toBe("Production");
    expect(s.selectedValue).toBe("prod");
    expect(s.index).toBe(-1);
  });

  it("tab on second item sets correct label and value", () => {
    const s = autocompleteReducer({ ...base, index: 1 }, { type: "key", key: key("tab") });
    expect(s.query).toBe("Staging");
    expect(s.selectedValue).toBe("stage");
  });

  it("enter sets query to label, selectedValue to value, done to true", () => {
    const s = autocompleteReducer({ ...base, index: 1 }, { type: "key", key: key("enter") });
    expect(s.done).toBe(true);
    expect(s.query).toBe("Staging");
    expect(s.selectedValue).toBe("stage");
  });

  it("enter with index=-1 picks first item", () => {
    const s = autocompleteReducer({ ...base, index: -1 }, { type: "key", key: key("enter") });
    expect(s.done).toBe(true);
    expect(s.query).toBe("Production");
    expect(s.selectedValue).toBe("prod");
  });

  it("typing a char after tab clears selectedValue", () => {
    const afterTab: AutocompleteState = {
      ...base,
      query: "Production",
      queryCursor: 10,
      selectedValue: "prod",
    };
    const s = autocompleteReducer(afterTab, { type: "key", key: char("x") });
    expect(s.selectedValue).toBeUndefined();
  });

  it("backspace after tab clears selectedValue", () => {
    const afterTab: AutocompleteState = {
      ...base,
      query: "Production",
      queryCursor: 10,
      selectedValue: "prod",
    };
    const s = autocompleteReducer(afterTab, { type: "key", key: key("backspace") });
    expect(s.selectedValue).toBeUndefined();
  });

  it("enter with no items falls back to selectedValue set by previous tab", () => {
    const afterTab: AutocompleteState = {
      ...base,
      items: [],
      index: -1,
      query: "Production",
      selectedValue: "prod",
    };
    const s = autocompleteReducer(afterTab, { type: "key", key: key("enter") });
    expect(s.done).toBe(true);
    expect(s.selectedValue).toBe("prod");
  });

  it("items action stores label/value choices", () => {
    const s = autocompleteReducer({ ...base, items: [], loading: true }, { type: "items", items });
    expect(s.items).toEqual(items);
    expect(s.loading).toBe(false);
    expect(s.index).toBe(0);
  });
});
