import type { ArgSchema } from "../parser/types.ts";
import { globalSchema } from "../parser/global-flags.ts";
import { makeStyler } from "./ansi.ts";
import type { CliInfo, HelpContext, RenderOptions, CommandSummary } from "./types.ts";

const INDENT = "  ";
const COL_GAP = 3; // min spaces between left and right columns

export function renderHelp(
  cli: CliInfo,
  ctx: HelpContext,
  opts: RenderOptions = {},
): string {
  const style = makeStyler(opts.noColor ?? false);
  const lines: string[] = [];

  const push = (...ls: string[]) => lines.push(...ls);

  // --- header ---
  if (ctx.level === "root") {
    const version = cli.version ? ` v${cli.version}` : "";
    push(`${style.bold(cli.name + version)} — ${cli.description}`, "");
    push(`${style.bold("Usage:")} ${cli.name} <command> [subcommand] [flags]`, "");
  } else if (ctx.level === "command") {
    push(`${style.bold(ctx.command.name)} — ${ctx.command.description}`, "");
    const hasSubcmds = ctx.subcommands.length > 0;
    const usageSuffix = hasSubcmds
      ? "<subcommand> [flags]"
      : buildPositionalUsage(ctx.command.schema) + "[flags]";
    push(`${style.bold("Usage:")} ${cli.name} ${ctx.command.name} ${usageSuffix}`, "");
  } else {
    push(
      `${style.bold(`${ctx.command.name} ${ctx.subcommand.name}`)} — ${ctx.subcommand.description}`,
      "",
    );
    push(
      `${style.bold("Usage:")} ${cli.name} ${ctx.command.name} ${ctx.subcommand.name} [flags]`,
      "",
    );
  }

  // --- commands list (root) ---
  if (ctx.level === "root" && ctx.commands.length > 0) {
    push(style.bold("Commands:"));
    push(...renderSummaries(ctx.commands));
    push("");
  }

  // --- subcommands list (command level) ---
  if (ctx.level === "command" && ctx.subcommands.length > 0) {
    push(style.bold("Subcommands:"));
    push(...renderSummaries(ctx.subcommands));
    push("");
  }

  // --- flags ---
  if (ctx.level === "root") {
    // root: only global flags
    const flagLines = renderFlagSection(globalSchema, style);
    if (flagLines.length > 0) {
      push(style.bold("Global Flags:"));
      push(...flagLines);
      push("");
    }
  } else if (ctx.level === "command") {
    // command: command flags + global flags
    const cmdFlagLines = renderFlagSection(ctx.command.schema, style, { excludeGlobals: true });
    if (cmdFlagLines.length > 0) {
      push(style.bold("Command Flags:"));
      push(...cmdFlagLines);
      push("");
    }
    const globalFlagLines = renderFlagSection(globalSchema, style);
    if (globalFlagLines.length > 0) {
      push(style.bold("Global Flags:"));
      push(...globalFlagLines);
      push("");
    }
  } else {
    // subcommand: subcommand flags + inherited command flags + global flags
    const subFlagLines = renderFlagSection(ctx.subcommand.schema, style, { excludeGlobals: true });
    if (subFlagLines.length > 0) {
      push(style.bold("Flags:"));
      push(...subFlagLines);
      push("");
    }

    const inheritedFlagLines = renderFlagSection(ctx.command.schema, style, {
      excludeGlobals: true,
      excludeHiddenInSubcommand: true,
    });
    if (inheritedFlagLines.length > 0) {
      push(style.bold(`Inherited from '${ctx.command.name}':`));
      push(...inheritedFlagLines);
      push("");
    }

    const globalFlagLines = renderFlagSection(globalSchema, style);
    if (globalFlagLines.length > 0) {
      push(style.bold("Global Flags:"));
      push(...globalFlagLines);
      push("");
    }
  }

  // --- footer hint ---
  if (ctx.level === "root") {
    push(style.dim(`Run '${cli.name} <command> --help' for command-specific help.`));
  } else if (ctx.level === "command" && ctx.subcommands.length > 0) {
    push(
      style.dim(
        `Run '${cli.name} ${ctx.command.name} <subcommand> --help' for subcommand-specific help.`,
      ),
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a usage fragment for positionals, e.g. "<name> " or "[args...] ". */
function buildPositionalUsage(schema: ArgSchema): string {
  const positionals = schema.positionals ?? [];
  if (positionals.length === 0) return "";
  return (
    positionals
      .map((p) =>
        p.variadic
          ? `[${p.name}...]`
          : `[${p.name}]`,
      )
      .join(" ") + " "
  );
}

function renderSummaries(items: CommandSummary[]): string[] {
  const colWidth = Math.max(...items.map((c) => c.name.length)) + COL_GAP;
  return items.map((c) => {
    const nameCol = (c.name + (c.aliases?.length ? `, ${c.aliases.join(", ")}` : "")).padEnd(colWidth);
    return `${INDENT}${nameCol}${c.description}`;
  });
}

interface FlagRenderOptions {
  excludeGlobals?: boolean;
  excludeHiddenInSubcommand?: boolean;
}

function renderFlagSection(
  schema: ArgSchema,
  style: ReturnType<typeof makeStyler>,
  opts: FlagRenderOptions = {},
): string[] {
  const globalFlagNames = new Set(Object.keys(globalSchema.flags ?? {}));
  const entries = Object.entries(schema.flags ?? {}).filter(([name, def]) => {
    if (opts.excludeGlobals && globalFlagNames.has(name)) return false;
    if (opts.excludeHiddenInSubcommand && def.hideInSubcommandHelp) return false;
    return true;
  });

  if (entries.length === 0) return [];

  const rows = entries.map(([name, def]) => {
    const alias = def.alias ? `, -${def.alias}` : "";
    const typeHint = def.type !== "boolean" ? ` <${def.type}>` : "";
    const multiple = def.multiple ? "..." : "";
    const left = `--${name}${alias}${typeHint}${multiple}`;
    const defaultHint =
      def.default !== undefined ? style.dim(` (default: ${def.default})`) : "";
    const right = (def.description ?? "") + defaultHint;
    return { left, right };
  });

  const colWidth = Math.max(...rows.map((r) => r.left.length)) + COL_GAP;
  return rows.map((r) => `${INDENT}${r.left.padEnd(colWidth)}${r.right}`);
}
