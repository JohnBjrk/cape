import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import { tokenize } from "./parser/tokenize.ts";
import { resolve, ParseError } from "./parser/resolve.ts";
import { globalSchema, mergeSchemas, extractGlobalFlags } from "./parser/global-flags.ts";
import { renderHelp } from "./help/render.ts";
import { BasicRuntime } from "./runtime/basic.ts";
import { discoverPlugins, loadPlugin } from "./loader/index.ts";
import { resolveCompletions } from "./completion/resolve.ts";
import { fromSchema, promptedToArgv } from "./prompt/from-schema.ts";
import { NonTtyError, PromptCancelledError } from "./prompt/types.ts";
import {
  generateCompletionScript,
  completionInstallPath,
  postInstallMessage,
  detectShell,
  type Shell,
} from "./completion/shell.ts";
import type { ArgSchema, ParsedArgs } from "./parser/types.ts";
import type { InferParsedArgs } from "./parser/infer.ts";
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

/**
 * Defines a subcommand with schema-inferred arg types.
 * TypeScript captures the exact schema shape and types `args` in `run` accordingly —
 * no casts needed inside the implementation.
 */
export function defineSubcommand<S extends ArgSchema>(def: {
  name: string;
  aliases?: string[];
  description: string;
  schema?: S;
  run(args: InferParsedArgs<S>, runtime: Runtime): Promise<void>;
}): SubcommandDef {
  return def as SubcommandDef;
}

/**
 * Defines a command with schema-inferred arg types.
 * TypeScript captures the exact schema shape and types `args` in `run` accordingly —
 * no casts needed inside the implementation.
 */
export function defineCommand<S extends ArgSchema>(def: {
  name: string;
  aliases?: string[];
  description: string;
  schema?: S;
  subcommands?: SubcommandDef[];
  run?(args: InferParsedArgs<S>, runtime: Runtime): Promise<void>;
}): CommandDef {
  return def as CommandDef;
}

export interface CliConfig extends CliInfo {
  /**
   * Additional directories to scan for *.plugin.toml files.
   * The framework always scans ./commands/ and ~/.config/<name>/plugins/
   * first — these dirs are appended after.
   */
  pluginDirs?: string[];
}

export function createCli(config: CliConfig, commands: CommandDef[] = []) {
  return {
    async run(argv: string[] = process.argv.slice(2)): Promise<void> {
      // Fast-path: --version never needs plugin discovery or parsing
      if (argv.some(a => a === "--version")) {
        if (config.version) {
          print(`${config.name} ${config.version}`);
        }
        return;
      }

      const userCommands = await resolveCommands(config, commands);
      const builtins = buildBuiltins(config);
      // User-defined commands (static + plugins) take priority over built-ins
      const allCommands = mergeByName(userCommands, builtins);

      // Completion mode: `mycli __complete <cword> [word0 word1 ... wordN]`
      // cword is the 0-based index of the partial word in the words array.
      if (argv[0] === "__complete") {
        const cword = parseInt(argv[1] ?? "0", 10);
        const words = argv.slice(2);
        const partial = words[cword] ?? "";
        const prevArgv = words.slice(0, cword);
        const results = await resolveCompletions(allCommands, prevArgv, partial);
        if (results.length > 0) process.stdout.write(results.join("\n") + "\n");
        return;
      }

      await dispatch(config, allCommands, argv);
    },
  };
}

/**
 * Merges statically defined commands with plugins discovered from disk.
 * Static commands take priority — a plugin with the same name as a static
 * command is silently skipped.
 */
async function resolveCommands(
  config: CliConfig,
  staticCommands: CommandDef[],
): Promise<CommandDef[]> {
  const staticNames = new Set(staticCommands.map((c) => c.name));
  const dirs = defaultPluginDirs(config.name).concat(config.pluginDirs ?? []);
  const discovered = await discoverPlugins(dirs);

  const pluginCommands: CommandDef[] = [];
  for (const plugin of discovered) {
    if (staticNames.has(plugin.manifest.name)) continue; // static wins
    try {
      const cmd = await loadPlugin(plugin, "run"); // mode is set per-dispatch in future
      pluginCommands.push(cmd);
    } catch (err) {
      console.warn(`[cape] Failed to load plugin "${plugin.manifest.name}": ${err}`);
    }
  }

  return [...staticCommands, ...pluginCommands];
}

function defaultPluginDirs(cliName: string): string[] {
  return [
    join(process.cwd(), "commands"),
    join(homedir(), ".config", cliName, "plugins"),
  ];
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

  // --- interactive prompting for missing required flags (TTY only) ---
  // Parse without required-checking first to discover what was provided,
  // then prompt for anything missing, and feed prompted values back as argv.
  let finalArgv = strippedArgv;
  if (process.stdin.isTTY) {
    try {
      const partial = resolve(tokenize(strippedArgv), merged, { skipRequired: true });
      const prompted = await fromSchema(merged, partial.provided);
      const extra = promptedToArgv(prompted);
      if (extra.length > 0) finalArgv = [...strippedArgv, ...extra];
    } catch (err) {
      if (err instanceof PromptCancelledError) {
        process.exit(130);
      }
      if (!(err instanceof NonTtyError)) throw err;
    }
  }

  // --- parse the stripped argv (command/subcommand names removed) ---
  let parsed: ParsedArgs;
  try {
    parsed = resolve(tokenize(finalArgv), merged);
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
// Built-in commands
// ---------------------------------------------------------------------------

/**
 * Returns the set of built-in commands provided by the framework.
 * Users can shadow any of these by defining a command with the same name.
 */
function buildBuiltins(config: CliConfig): CommandDef[] {
  return [completionsCommand(config)];
}

function completionsCommand(config: CliConfig): CommandDef {
  const shellFlag = {
    type: "string" as const,
    description: "Shell type: bash, zsh, or fish (default: auto-detect from $SHELL)",
    complete: { type: "static" as const, values: ["bash", "zsh", "fish"] },
  };

  return {
    name: "completions",
    description: "Manage shell tab completions",
    subcommands: [
      {
        name: "generate",
        description: "Print the completion script for your shell to stdout",
        schema: { flags: { shell: shellFlag } },
        async run(args, runtime) {
          const shell = resolveShellArg(args.flags["shell"] as string | undefined, runtime);
          if (!shell) return;
          runtime.print(generateCompletionScript(config.name, shell));
        },
      },
      {
        name: "install",
        description: "Install tab completions for your shell",
        schema: { flags: { shell: shellFlag } },
        async run(args, runtime) {
          const shell = resolveShellArg(args.flags["shell"] as string | undefined, runtime);
          if (!shell) return;

          const script = generateCompletionScript(config.name, shell);
          const destPath = completionInstallPath(config.name, shell);

          // Ensure parent directory exists
          const dir = destPath.slice(0, destPath.lastIndexOf("/"));
          await mkdir(dir, { recursive: true });
          await Bun.write(destPath, script);

          runtime.print(postInstallMessage(config.name, shell, destPath));
        },
      },
    ],
  };
}

/** Validates and returns the shell argument, printing an error on invalid input. */
function resolveShellArg(raw: string | undefined, runtime: Runtime): Shell | undefined {
  const detected = detectShell();
  const shell = (raw ?? detected) as Shell | undefined;
  if (!shell) {
    runtime.printError(
      "Error: could not detect shell. Pass --shell bash, --shell zsh, or --shell fish.",
    );
    return undefined;
  }
  if (!["bash", "zsh", "fish"].includes(shell)) {
    runtime.printError(`Error: unsupported shell "${shell}". Use bash, zsh, or fish.`);
    return undefined;
  }
  return shell;
}

/**
 * Merges two command arrays. `primary` wins on name collision —
 * any command in `fallback` whose name already appears in `primary` is skipped.
 */
function mergeByName(primary: CommandDef[], fallback: CommandDef[]): CommandDef[] {
  const names = new Set(primary.map(c => c.name));
  return [...primary, ...fallback.filter(c => !names.has(c.name))];
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
      if (def) {
        // Known flag: skip 1 for boolean, 2 for value-consuming flags
        i += def.type !== "boolean" ? 2 : 1;
      } else {
        // Unknown flag: if the next token looks like a value (not a flag), consume it too.
        // This prevents typos like `--nane Alice` from misidentifying "Alice" as a command.
        const next = argv[i + 1];
        i += (next && !next.startsWith("-") && next !== "--") ? 2 : 1;
      }
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
