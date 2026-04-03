import type { Token } from "./types.ts";

/**
 * Converts raw argv into a flat token stream.
 *
 * Rules:
 * - "--" → separator token; all subsequent args become values (passthrough)
 * - "--flag=value" → two tokens: flag "--flag", value "value"
 * - "--flag" / "-f" → flag token
 * - "-abc" → cluster, expanded to flag tokens "-a", "-b", "-c"
 * - anything else → value token
 */
export function tokenize(argv: string[]): Token[] {
  const tokens: Token[] = [];
  let pastSeparator = false;

  for (const arg of argv) {
    if (pastSeparator) {
      tokens.push({ type: "value", raw: arg });
      continue;
    }

    if (arg === "--") {
      tokens.push({ type: "separator", raw: "--" });
      pastSeparator = true;
      continue;
    }

    // --flag=value
    if (arg.startsWith("--") && arg.includes("=")) {
      const eq = arg.indexOf("=");
      tokens.push({ type: "flag", raw: arg.slice(0, eq) });
      tokens.push({ type: "value", raw: arg.slice(eq + 1) });
      continue;
    }

    // --flag or -f
    if (arg.startsWith("--") || (arg.startsWith("-") && arg.length === 2)) {
      tokens.push({ type: "flag", raw: arg });
      continue;
    }

    // -abc cluster → -a -b -c
    if (arg.startsWith("-") && arg.length > 2 && !arg.startsWith("--")) {
      for (const char of arg.slice(1)) {
        tokens.push({ type: "flag", raw: `-${char}` });
      }
      continue;
    }

    tokens.push({ type: "value", raw: arg });
  }

  return tokens;
}
