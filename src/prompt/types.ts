// ---------------------------------------------------------------------------
// Key events
// ---------------------------------------------------------------------------

export type Key =
  | { type: "char"; char: string }
  | { type: "up" }
  | { type: "down" }
  | { type: "left" }
  | { type: "right" }
  | { type: "enter" }
  | { type: "backspace" }
  | { type: "delete" }
  | { type: "home" }
  | { type: "end" }
  | { type: "tab" }
  | { type: "escape" }
  | { type: "interrupt" };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when a prompt is invoked but stdin is not a TTY. */
export class NonTtyError extends Error {
  constructor(message = "stdin is not a TTY — cannot display interactive prompt") {
    super(message);
    this.name = "NonTtyError";
  }
}

/** Thrown when the user cancels a prompt (Ctrl+C or Escape). */
export class PromptCancelledError extends Error {
  constructor() {
    super("Prompt cancelled by user");
    this.name = "PromptCancelledError";
  }
}

// ---------------------------------------------------------------------------
// Prompt option types
// ---------------------------------------------------------------------------

export interface TextPromptOptions {
  message: string;
  /** Pre-filled default value shown in the input. */
  default?: string;
  /** Return an error message string to reject the value, or undefined to accept. */
  validate?: (value: string) => string | undefined;
  signal?: AbortSignal;
}

export interface SelectPromptOptions {
  message: string;
  choices: string[];
  /** Initially highlighted choice. */
  default?: string;
  signal?: AbortSignal;
}

export interface ConfirmPromptOptions {
  message: string;
  /** If true, Enter accepts `true`; if false, Enter accepts `false`. Default: false. */
  default?: boolean;
  signal?: AbortSignal;
}

export interface MultiSelectPromptOptions {
  message: string;
  choices: string[];
  /** Pre-checked choices. */
  defaults?: string[];
  signal?: AbortSignal;
}

export interface AutocompletePromptOptions {
  message: string;
  /**
   * Static array of choices filtered locally, or an async function called on
   * each query change with debouncing. The function receives the current query
   * and an AbortSignal (aborted when a new query supersedes this one).
   */
  choices: string[] | ((query: string, signal: AbortSignal) => Promise<string[]>);
  default?: string;
  /** Debounce delay for dynamic fetchers (ms). Default: 150. */
  debounceMs?: number;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Prompt interface (exposed on Runtime.prompt)
// ---------------------------------------------------------------------------

/**
 * All interactive prompt methods, pre-bound to the command's AbortSignal.
 * Access via `runtime.prompt` — no separate imports needed.
 *
 * All methods throw NonTtyError when stdin is not a TTY, and
 * PromptCancelledError when the user presses Ctrl+C or Escape.
 */
export interface PromptInterface {
  /** Free-form text input. */
  text(options: Omit<TextPromptOptions, "signal">): Promise<string>;
  /** Yes/no confirmation. */
  confirm(options: Omit<ConfirmPromptOptions, "signal">): Promise<boolean>;
  /** Single choice from a list. */
  select(options: Omit<SelectPromptOptions, "signal">): Promise<string>;
  /** Multiple choices from a list. */
  multiSelect(options: Omit<MultiSelectPromptOptions, "signal">): Promise<string[]>;
  /** Text input with live-filtered suggestions (static list or async fetch). */
  autocomplete(options: Omit<AutocompletePromptOptions, "signal">): Promise<string>;
  /** Thrown when a prompt is invoked outside a TTY. */
  NonTtyError: typeof NonTtyError;
  /** Thrown when the user cancels a prompt (Ctrl+C or Escape). */
  PromptCancelledError: typeof PromptCancelledError;
}
