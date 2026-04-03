/** ANSI escape codes for prompt rendering. */

const E = "\x1b[";

export const cursor = {
  up:   (n = 1) => `${E}${n}A`,
  down: (n = 1) => `${E}${n}B`,
  col:  (n: number) => `${E}${n}G`,
  hide: `${E}?25l`,
  show: `${E}?25h`,
};

export const erase = {
  /** Erase entire current line. */
  line: `${E}2K`,
  /** Erase from cursor to end of screen. */
  down: `${E}J`,
};

export const style = {
  bold:   (s: string) => `${E}1m${s}${E}0m`,
  dim:    (s: string) => `${E}2m${s}${E}0m`,
  cyan:   (s: string) => `${E}36m${s}${E}0m`,
  green:  (s: string) => `${E}32m${s}${E}0m`,
  red:    (s: string) => `${E}31m${s}${E}0m`,
  yellow: (s: string) => `${E}33m${s}${E}0m`,
  reset:  `${E}0m`,
};

/** Moves up `lines` and erases to end of screen — the standard "clear and redraw" pattern. */
export function clearAbove(lines: number): string {
  if (lines <= 0) return "";
  return cursor.up(lines) + erase.down;
}

/** Counts the number of rendered lines in a string (newline count). */
export function countLines(s: string): number {
  let n = 0;
  for (const ch of s) if (ch === "\n") n++;
  return n;
}
