/** Minimal ANSI helpers — no dependencies. */

const ESC = "\x1b[";

export const ansi = {
  bold:  (s: string) => `${ESC}1m${s}${ESC}0m`,
  dim:   (s: string) => `${ESC}2m${s}${ESC}0m`,
  reset: `${ESC}0m`,
};

/** Returns a passthrough identity function when color is disabled. */
export function makeStyler(noColor: boolean) {
  if (noColor) return { bold: (s: string) => s, dim: (s: string) => s };
  return ansi;
}
