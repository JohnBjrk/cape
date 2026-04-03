import type { ArgSchema, ParsedArgs, Token } from "./types.ts";

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = "ParseError";
  }
}

export interface ResolveOptions {
  /**
   * When true, skips the required-flag and required-positional checks.
   * Useful for partial parsing (e.g. before interactive prompting fills in
   * missing required values).
   */
  skipRequired?: boolean;
}

export function resolve(tokens: Token[], schema: ArgSchema, opts?: ResolveOptions): ParsedArgs {
  const schemaFlags = schema.flags ?? {};
  const positionalDefs = schema.positionals ?? [];

  // alias → canonical flag name
  const aliasMap = new Map<string, string>();
  for (const [name, def] of Object.entries(schemaFlags)) {
    if (def.alias) aliasMap.set(`-${def.alias}`, name);
  }

  const flags: Record<string, unknown> = {};
  const positionals: string[] = [];
  const passthrough: string[] = [];
  const provided = new Set<string>(); // flags explicitly set by the user
  let pastSeparator = false;
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i]!;

    if (token.type === "separator") {
      pastSeparator = true;
      i++;
      continue;
    }

    if (pastSeparator || token.type === "value") {
      (pastSeparator ? passthrough : positionals).push(token.raw);
      i++;
      continue;
    }

    // --- flag token ---
    const raw = token.raw;
    const canonical = raw.startsWith("--")
      ? raw.slice(2)
      : aliasMap.get(raw);

    const def = canonical !== undefined ? schemaFlags[canonical] : undefined;

    if (canonical === undefined || def === undefined) {
      const suggestion = closestFlag(raw, Object.keys(schemaFlags));
      throw new ParseError(
        `unknown flag ${raw}`,
        suggestion ? `did you mean --${suggestion}?` : undefined,
      );
    }

    if (def.type === "boolean") {
      setValue(flags, canonical, true, def.multiple ?? false);
      provided.add(canonical);
      i++;
      continue;
    }

    // string / number — consume the next value token
    const next = tokens[i + 1];
    if (!next || next.type !== "value") {
      throw new ParseError(`flag --${canonical} requires a value`);
    }

    const rawValue = next.raw;

    if (def.type === "number") {
      const n = Number(rawValue);
      if (Number.isNaN(n)) {
        throw new ParseError(
          `--${canonical} expects a number, got "${rawValue}"`,
        );
      }
      setValue(flags, canonical, n, def.multiple ?? false);
    } else {
      setValue(flags, canonical, rawValue, def.multiple ?? false);
    }

    provided.add(canonical);
    i += 2;
  }

  // Apply defaults for flags not explicitly provided
  for (const [name, def] of Object.entries(schemaFlags)) {
    if (provided.has(name)) continue;
    if (def.default !== undefined) {
      flags[name] = def.default;
    } else if (def.multiple) {
      flags[name] = [];
    } else if (def.type === "boolean") {
      flags[name] = false;
    }
  }

  if (!opts?.skipRequired) {
    // Required flag check (only for string/number — required boolean is nonsensical)
    for (const [name, def] of Object.entries(schemaFlags)) {
      if (def.required && def.type !== "boolean" && !provided.has(name)) {
        throw new ParseError(`missing required flag --${name}`);
      }
    }

    // Required positional check
    for (let j = 0; j < positionalDefs.length; j++) {
      const posDef = positionalDefs[j]!;
      if (!posDef.variadic && positionals[j] === undefined) {
        throw new ParseError(`missing required argument <${posDef.name}>`);
      }
    }
  }

  return { flags, positionals, passthrough, provided };
}

function setValue(
  flags: Record<string, unknown>,
  name: string,
  value: unknown,
  multiple: boolean,
): void {
  if (multiple) {
    if (!Array.isArray(flags[name])) flags[name] = [];
    (flags[name] as unknown[]).push(value);
  } else {
    flags[name] = value;
  }
}

/** Levenshtein distance — used for did-you-mean suggestions on unknown flags. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let r = 1; r <= m; r++) {
    for (let c = 1; c <= n; c++) {
      dp[r]![c] =
        a[r - 1] === b[c - 1]
          ? dp[r - 1]![c - 1]!
          : 1 + Math.min(dp[r - 1]![c]!, dp[r]![c - 1]!, dp[r - 1]![c - 1]!);
    }
  }
  return dp[m]![n]!;
}

/** Returns the closest flag name if within edit-distance 2, otherwise undefined. */
function closestFlag(raw: string, names: string[]): string | undefined {
  const input = raw.replace(/^-+/, ""); // strip leading dashes for comparison
  let best: string | undefined;
  let bestDist = Infinity;
  for (const name of names) {
    const d = editDistance(input, name);
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return bestDist <= 2 ? best : undefined;
}
