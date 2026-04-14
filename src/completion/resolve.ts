import type { ArgSchema, CompletionCtx, CompletionSource } from "../parser/types.ts";
import { choiceValue } from "../parser/types.ts";
import type { CommandDef } from "../cli.ts";
import { globalSchema, mergeSchemas } from "../parser/global-flags.ts";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { xdgCacheHome } from "../runtime/fs.ts";

type FlagDef = NonNullable<ArgSchema["flags"]>[string];

type CompletionSlot =
  | { kind: "command" }
  | { kind: "subcommand"; command: CommandDef }
  | { kind: "flag-name"; schema: ArgSchema; provided: Set<string> }
  | {
      kind: "flag-value";
      flagName: string;
      source: CompletionSource | undefined;
      ctx: CompletionCtx;
    }
  | { kind: "positional"; index: number; source: CompletionSource | undefined; ctx: CompletionCtx };

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  expires: number;
  values: string[];
}

/**
 * Given the tokens already on the command line (before the cursor) and the
 * partial word being completed, returns completion candidates.
 *
 * @param commands  All available commands (static + loaded plugins)
 * @param argv      Tokens already typed, NOT including the partial word
 * @param partial   The word currently being completed (may be "")
 * @param cliName   CLI name used to scope the on-disk cache directory
 */
export async function resolveCompletions(
  commands: CommandDef[],
  argv: string[],
  partial: string,
  cliName?: string,
): Promise<string[]> {
  const slot = computeSlot(commands, argv, partial);
  return fetchCandidates(slot, partial, commands, cliName);
}

// ---------------------------------------------------------------------------
// Slot resolution — figures out what the cursor is completing
// ---------------------------------------------------------------------------

function computeSlot(commands: CommandDef[], argv: string[], partial: string): CompletionSlot {
  // Pass 1: find command name in argv
  const cmdResult = freeValueAt(argv, 0, globalSchema);
  const command = cmdResult ? findByName(commands, cmdResult.value) : undefined;

  if (!command || !cmdResult) {
    if (partial.startsWith("-")) {
      return { kind: "flag-name", schema: globalSchema, provided: new Set() };
    }
    return { kind: "command" };
  }

  const cmdSchema = command.schema ?? {};
  const subcommands = command.subcommands ?? [];

  // Pass 2: find subcommand name in argv
  const subScanSchema = mergeSchemas(globalSchema, cmdSchema);
  const subResult = freeValueAt(argv, cmdResult.index + 1, subScanSchema);
  const subcommand = subResult ? findByName(subcommands, subResult.value) : undefined;

  // Strip command/subcommand tokens for flag analysis
  const subIdx = subResult && subcommand ? subResult.index : -1;
  const stripped = argv.filter((_, i) => i !== cmdResult.index && i !== subIdx);

  // Active schema for the current context
  const subSchema = subcommand?.schema ?? {};
  const activeSchema = subcommand
    ? mergeSchemas(mergeSchemas(globalSchema, cmdSchema), subSchema)
    : mergeSchemas(globalSchema, cmdSchema);

  // Walk stripped argv to find current parse state
  const { provided, expectingValueFor } = walkArgv(stripped, activeSchema);

  // If the last token was a value-taking flag and no value followed, we're completing its value
  if (expectingValueFor) {
    const flagDef = lookupFlag(activeSchema, expectingValueFor);
    return {
      kind: "flag-value",
      flagName: expectingValueFor,
      source: flagDef?.complete,
      ctx: { partial, flags: collectFlags(stripped, activeSchema) },
    };
  }

  // Completing a flag name
  if (partial.startsWith("-")) {
    return { kind: "flag-name", schema: activeSchema, provided };
  }

  // Completing a subcommand name (command has subcommands, none typed yet)
  if (!subcommand && subcommands.length > 0) {
    return { kind: "subcommand", command };
  }

  // Completing a positional
  const posIdx = countPositionals(stripped, activeSchema);
  const posDefs = activeSchema.positionals ?? [];
  return {
    kind: "positional",
    index: posIdx,
    source: posDefs[posIdx]?.complete,
    ctx: { partial, flags: collectFlags(stripped, activeSchema) },
  };
}

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

async function fetchCandidates(
  slot: CompletionSlot,
  partial: string,
  commands: CommandDef[],
  cliName?: string,
): Promise<string[]> {
  switch (slot.kind) {
    case "command":
      return filterPrefix(
        commands.flatMap((c) => [c.name, ...(c.aliases ?? [])]),
        partial,
      );

    case "subcommand":
      return filterPrefix(
        (slot.command.subcommands ?? []).flatMap((s) => [s.name, ...(s.aliases ?? [])]),
        partial,
      );

    case "flag-name":
      return filterPrefix(flagNameCandidates(slot.schema, slot.provided), partial);

    case "flag-value":
      return filterPrefix(
        await fetchSource(slot.source, slot.ctx, `flag:${slot.flagName}`, cliName),
        partial,
      );

    case "positional":
      return filterPrefix(
        await fetchSource(slot.source, slot.ctx, `pos:${slot.index}`, cliName),
        partial,
      );
  }
}

async function fetchSource(
  source: CompletionSource | undefined,
  ctx: CompletionCtx,
  slotKey: string,
  cliName?: string,
): Promise<string[]> {
  if (!source) return [];
  if (source.type === "static") return source.values.map(choiceValue);

  // Dynamic source — check filesystem cache first
  const cacheFile = cliName ? completionCachePath(cliName, slotKey, ctx) : undefined;
  if (cacheFile) {
    const cached = await readCache(cacheFile);
    if (cached) return cached;
  }

  let values: string[];
  try {
    values = (await withTimeout(source.fetch(ctx), source.timeoutMs ?? 5000)).map(choiceValue);
  } catch {
    return [];
  }

  if (cacheFile) {
    // Write cache in background — don't block the completion response
    writeCache(cacheFile, values).catch(() => {});
  }

  return values;
}

// ---------------------------------------------------------------------------
// Filesystem cache helpers (Bun-native)
// ---------------------------------------------------------------------------

function completionCachePath(cliName: string, slotKey: string, ctx: CompletionCtx): string {
  const key = `${cliName}:${slotKey}:${JSON.stringify(ctx)}`;
  const hash = Bun.hash(key).toString(16);
  return join(xdgCacheHome(), cliName, "completions", `${hash}.json`);
}

async function readCache(path: string): Promise<string[] | undefined> {
  const f = Bun.file(path);
  if (!(await f.exists())) return undefined;
  try {
    const entry = (await f.json()) as CacheEntry;
    return entry.expires > Date.now() ? entry.values : undefined;
  } catch {
    return undefined;
  }
}

async function writeCache(path: string, values: string[]): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  const entry: CacheEntry = { expires: Date.now() + CACHE_TTL_MS, values };
  await Bun.write(path, JSON.stringify(entry));
}

/**
 * Returns --flag and -alias candidates for all flags not yet fully provided.
 * Already-provided non-multiple flags are excluded.
 */
function flagNameCandidates(schema: ArgSchema, provided: Set<string>): string[] {
  const flags = schema.flags ?? {};
  const candidates: string[] = [];
  for (const [name, def] of Object.entries(flags)) {
    if (!def.multiple && provided.has(name)) continue;
    candidates.push(`--${name}`);
    if (def.alias) candidates.push(`-${def.alias}`);
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Argv walking helpers
// ---------------------------------------------------------------------------

/**
 * Walks stripped argv (command/subcommand tokens already removed) to determine:
 * - which flags have been explicitly provided
 * - whether the final token is a value-taking flag with no value yet typed
 *   (meaning the partial word is its value)
 */
function walkArgv(
  argv: string[],
  schema: ArgSchema,
): { provided: Set<string>; expectingValueFor: string | undefined } {
  const flags = schema.flags ?? {};
  const provided = new Set<string>();
  let expectingValueFor: string | undefined;

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    expectingValueFor = undefined;

    if (arg === "--") break;

    if (!arg.startsWith("-")) {
      i++;
      continue;
    }

    // --flag=value: value embedded, no lookahead needed
    const eqIdx = arg.indexOf("=");
    if (eqIdx !== -1) {
      const name = canonicalize(arg.slice(0, eqIdx), flags);
      if (name) provided.add(name);
      i++;
      continue;
    }

    const name = canonicalize(arg, flags);
    if (!name) {
      i++;
      continue;
    }

    const def = flags[name];
    if (!def || def.type === "boolean") {
      provided.add(name);
      i++;
      continue;
    }

    // Non-boolean flag: next token is its value
    provided.add(name);
    if (i + 1 < argv.length) {
      i += 2; // skip flag + value
    } else {
      // No value token follows — partial IS the value
      expectingValueFor = name;
      i++;
    }
  }

  return { provided, expectingValueFor };
}

/**
 * Counts positional (non-flag) values in stripped argv.
 * Used to determine which positional slot we're about to complete.
 */
function countPositionals(argv: string[], schema: ArgSchema): number {
  const flags = schema.flags ?? {};
  let count = 0;
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === "--") break;
    if (!arg.startsWith("-")) {
      count++;
      i++;
      continue;
    }
    if (arg.includes("=")) {
      i++;
      continue;
    }
    const name = canonicalize(arg, flags);
    const def = name ? flags[name] : undefined;
    i += def && def.type !== "boolean" ? 2 : 1;
  }
  return count;
}

/**
 * Best-effort flag value extraction from stripped argv.
 * Passed as context to dynamic completers so they can make dependent lookups.
 */
function collectFlags(argv: string[], schema: ArgSchema): Record<string, unknown> {
  const flags = schema.flags ?? {};
  const result: Record<string, unknown> = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === "--") break;
    if (!arg.startsWith("-")) {
      i++;
      continue;
    }

    const eqIdx = arg.indexOf("=");
    if (eqIdx !== -1) {
      const name = canonicalize(arg.slice(0, eqIdx), flags);
      if (name) result[name] = arg.slice(eqIdx + 1);
      i++;
      continue;
    }

    const name = canonicalize(arg, flags);
    if (!name) {
      i++;
      continue;
    }
    const def = flags[name];
    if (!def) {
      i++;
      continue;
    }

    if (def.type === "boolean") {
      result[name] = true;
      i++;
    } else if (i + 1 < argv.length) {
      result[name] = argv[i + 1];
      i += 2;
    } else {
      i++;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Converts a raw flag token (e.g. "--name" or "-n") to its canonical flag
 * name using the schema's alias map. Returns undefined for unknown flags.
 */
function canonicalize(raw: string, flags: NonNullable<ArgSchema["flags"]>): string | undefined {
  if (raw.startsWith("--")) return raw.slice(2);
  if (raw.startsWith("-") && raw.length === 2) {
    for (const [name, def] of Object.entries(flags)) {
      if (def.alias === raw[1]) return name;
    }
  }
  return undefined;
}

/**
 * Walks argv from startIndex and returns the first free (non-flag) value,
 * skipping flag+value pairs using the schema so flag values aren't mistaken
 * for command or subcommand names.
 */
function freeValueAt(
  argv: string[],
  startIndex: number,
  schema: ArgSchema,
): { value: string; index: number } | undefined {
  const flags = schema.flags ?? {};
  let i = startIndex;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === "--") break;
    if (!arg.startsWith("-")) return { value: arg, index: i };
    if (arg.includes("=")) {
      i++;
      continue;
    }
    const name = canonicalize(arg, flags);
    const def = name ? flags[name] : undefined;
    i += def && def.type !== "boolean" ? 2 : 1;
  }
  return undefined;
}

function findByName<T extends { name: string; aliases?: string[] }>(
  items: T[],
  name: string,
): T | undefined {
  return items.find((item) => item.name === name || (item.aliases ?? []).includes(name));
}

function filterPrefix(values: string[], prefix: string): string[] {
  if (!prefix) return values;
  return values.filter((v) => v.startsWith(prefix));
}

function lookupFlag(schema: ArgSchema, canonical: string): FlagDef | undefined {
  return schema.flags?.[canonical];
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("completion timeout")), ms),
    ),
  ]);
}
