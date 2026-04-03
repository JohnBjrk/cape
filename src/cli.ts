import { tokenize } from "./parser/tokenize.ts";
import { resolve, ParseError } from "./parser/resolve.ts";
import { globalSchema, mergeSchemas, extractGlobalFlags } from "./parser/global-flags.ts";
import { renderHelp } from "./help/render.ts";
import { BasicRuntime } from "./runtime/basic.ts";
import type { ArgSchema, ParsedArgs } from "./parser/types.ts";
import type { CliInfo, CommandSummary } from "./help/types.ts";
import type { Runtime } from "./runtime/types.ts";

export interface SubcommandDef {
  name: string;
  aliases?: string[];
  description: string;
  schema?: ArgSchema;
  run(args: ParsedArgs, runtime: Runtime): Promise<void>;
}

export interface CommandDef {
  name: string;
  aliases?: string[];
  description: string;
  schema?: ArgSchema;
  subcommands?: SubcommandDef[];
  run?(args: ParsedArgs, runtime: Runtime): Promise<void>;
}

export interface CliConfig extends CliInfo {}

export function createCli(config: CliConfig, commands: CommandDef[]) {
  return {
    async run(argv: string[] = process.argv.slice(2)): Promise<void> {
      await dispatch(config, commands, argv);
    },
  };
}

// ---------------------------------------------------------------------------

async function dispatch(
  config: CliConfig,
  commands: CommandDef[],
  argv: string[],
): Promise<void> {
  const tokens = tokenize(argv);

  // Scan argv left-to-right for the first non-flag value — that's the command.
  // We do this on raw argv (not tokens) for simplicity: the first arg that
  // doesn't start with "-" and isn't a flag value is the command name.
  const { commandName, subcommandName, strippedArgv } = extractCommandTokens(argv, commands);

  // --- no command: show root help ---
  if (!commandName) {
    try {
      const parsed = resolve(tokens, globalSchema);
      const globals = extractGlobalFlags(parsed);
      if (globals.help) {
        print(renderHelp(config, { level: "root", commands: toSummaries(commands) }, { noColor: globals.noColor }));
        return;
      }
    } catch { /* ignore parse errors at root with no command */ }
    print(renderHelp(config, { level: "root", commands: toSummaries(commands) }));
    return;
  }

  // --- find the command ---
  const command = findByName(commands, commandName);

  if (!command) {
    const suggestion = closestName(commandName, commands.map((c) => c.name));
    printError(`Error: unknown command "${commandName}"${suggestion ? ` — did you mean "${suggestion}"?` : ""}`);
    printError(`Run '${config.name} --help' to see available commands.`);
    process.exit(2);
  }

  const cmdSchema = command.schema ?? {};
  const subcommands = command.subcommands ?? [];

  // --- find the subcommand (if any) ---
  const subcommand = subcommandName ? findByName(subcommands, subcommandName) : undefined;

  if (subcommandName && !subcommand) {
    // Try to parse enough to check --help before erroring
    try {
      const merged = mergeSchemas(globalSchema, cmdSchema);
      const parsed = resolve(tokenize(strippedArgv), merged);
      const globals = extractGlobalFlags(parsed);
      if (globals.help) {
        print(renderHelp(config, { level: "command", command: { name: command.name, description: command.description, schema: cmdSchema }, subcommands: toSummaries(subcommands) }, { noColor: globals.noColor }));
        return;
      }
    } catch { /* ignore */ }

    const suggestion = closestName(subcommandName, subcommands.map((s) => s.name));
    printError(`Error: unknown subcommand "${subcommandName}"${suggestion ? ` — did you mean "${suggestion}"?` : ""}`);
    printError(`Run '${config.name} ${command.name} --help' to see available subcommands.`);
    process.exit(2);
  }

  // --- build merged schema for parsing ---
  // Global + command flags are always valid; subcommand flags added if present.
  const subSchema = subcommand?.schema ?? {};
  const merged = subcommand
    ? mergeSchemas(mergeSchemas(globalSchema, cmdSchema), subSchema)
    : mergeSchemas(globalSchema, cmdSchema);

  // --- short-circuit for --help before full validation ---
  // Check raw tokens so required-flag validation doesn't block help display.
  if (hasHelpFlag(strippedArgv)) {
    const noColor = strippedArgv.includes("--no-color");
    if (subcommand) {
      print(renderHelp(config, {
        level: "subcommand",
        command:    { name: command.name,    description: command.description,    schema: cmdSchema },
        subcommand: { name: subcommand.name, description: subcommand.description, schema: subSchema },
      }, { noColor }));
    } else {
      print(renderHelp(config, {
        level: "command",
        command: { name: command.name, description: command.description, schema: cmdSchema },
        subcommands: toSummaries(subcommands),
      }, { noColor }));
    }
    return;
  }

  // --- parse the stripped argv (command/subcommand names removed) ---
  let parsed: ParsedArgs;
  try {
    parsed = resolve(tokenize(strippedArgv), merged);
  } catch (err) {
    if (err instanceof ParseError) {
      printError(`Error: ${err.message}`);
      if (err.suggestion) printError(`       ${err.suggestion}`);
      const helpCmd = subcommand
        ? `${config.name} ${command.name} ${subcommand.name}`
        : `${config.name} ${command.name}`;
      printError(`Run '${helpCmd} --help' to see available flags.`);
      process.exit(2);
    }
    throw err;
  }

  const globals = extractGlobalFlags(parsed);

  // --- run ---
  const runtime = new BasicRuntime(parsed, getEnv());

  if (subcommand) {
    await subcommand.run(parsed, runtime);
  } else if (command.run) {
    await command.run(parsed, runtime);
  } else {
    // Command has subcommands but none was specified — show command help
    print(renderHelp(config, {
      level: "command",
      command: { name: command.name, description: command.description, schema: cmdSchema },
      subcommands: toSummaries(subcommands),
    }));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts command and subcommand names from argv using schema-aware scanning
 * so that flag values (e.g. `--name World`) are not mistaken for command tokens.
 *
 * Pass 1: scan with globalSchema to find the command name.
 * Pass 2: scan with global+command schema to find the subcommand name.
 * Returns argv with those two tokens removed for downstream parsing.
 */
function extractCommandTokens(
  argv: string[],
  commands: CommandDef[],
): {
  commandName: string | undefined;
  subcommandName: string | undefined;
  strippedArgv: string[];
} {
  // Pass 1: find command name, skipping flag values using globalSchema
  const cmdResult = schemaAwareFreeValue(argv, 0, globalSchema);
  if (!cmdResult) {
    return { commandName: undefined, subcommandName: undefined, strippedArgv: argv };
  }

  const commandName = cmdResult.value;
  const command = findByName(commands, commandName);

  // Pass 2: find subcommand name using global + command schema
  let subcommandName: string | undefined;
  let subIdx = -1;
  if (command) {
    const scanSchema = mergeSchemas(globalSchema, command.schema ?? {});
    const subResult = schemaAwareFreeValue(argv, cmdResult.index + 1, scanSchema);
    if (subResult) {
      subcommandName = subResult.value;
      subIdx = subResult.index;
    }
  }

  const strippedArgv = argv.filter((_, i) => i !== cmdResult.index && i !== subIdx);
  return { commandName, subcommandName, strippedArgv };
}

/**
 * Walks argv from `startIndex`, skipping flags and their values (using the
 * schema to know which flags consume a value), and returns the first free
 * value token — i.e. a positional, command name, or subcommand name.
 */
function schemaAwareFreeValue(
  argv: string[],
  startIndex: number,
  schema: ArgSchema,
): { value: string; index: number } | undefined {
  const flags = schema.flags ?? {};
  const aliasMap = new Map<string, string>();
  for (const [name, def] of Object.entries(flags)) {
    if (def.alias) aliasMap.set(`-${def.alias}`, name);
  }

  let i = startIndex;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === "--") break;

    if (arg.startsWith("-")) {
      // --flag=value: value is embedded, skip only this token
      if (arg.includes("=")) { i++; continue; }

      const canonical = arg.startsWith("--") ? arg.slice(2) : aliasMap.get(arg);
      const def = canonical !== undefined ? flags[canonical] : undefined;
      // If the flag takes a value, skip flag + next token; otherwise just skip flag
      i += def && def.type !== "boolean" ? 2 : 1;
      continue;
    }

    return { value: arg, index: i };
  }
  return undefined;
}

function findByName<T extends { name: string; aliases?: string[] }>(
  items: T[],
  name: string,
): T | undefined {
  return items.find(
    (item) => item.name === name || (item.aliases ?? []).includes(name),
  );
}

function toSummaries(items: { name: string; aliases?: string[]; description: string }[]): CommandSummary[] {
  return items.map(({ name, aliases, description }) => ({ name, aliases, description }));
}

function closestName(input: string, names: string[]): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const name of names) {
    const d = editDistance(input, name);
    if (d < bestDist) { bestDist = d; best = name; }
  }
  return bestDist <= 2 ? best : undefined;
}

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let r = 1; r <= m; r++)
    for (let c = 1; c <= n; c++)
      dp[r]![c] = a[r-1] === b[c-1]
        ? dp[r-1]![c-1]!
        : 1 + Math.min(dp[r-1]![c]!, dp[r]![c-1]!, dp[r-1]![c-1]!);
  return dp[m]![n]!;
}

function getEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
}

/** Returns true if --help or -h appears in argv before the -- separator. */
function hasHelpFlag(argv: string[]): boolean {
  for (const arg of argv) {
    if (arg === "--") break;
    if (arg === "--help" || arg === "-h") return true;
  }
  return false;
}

function print(text: string): void { process.stdout.write(text + "\n"); }
function printError(text: string): void { process.stderr.write(text + "\n"); }
