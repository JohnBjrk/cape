import type { ArgSchema } from "../parser/types.ts";

export interface CliInfo {
  name: string;
  displayName?: string;
  version?: string;
  description: string;
}

export interface CommandSummary {
  name: string;
  aliases?: string[];
  description: string;
}

export interface CommandDetail {
  name: string;
  description: string;
  schema: ArgSchema;
}

export type HelpContext =
  | { level: "root"; commands: CommandSummary[] }
  | { level: "command"; command: CommandDetail; subcommands: CommandSummary[] }
  | { level: "subcommand"; command: CommandDetail; subcommand: CommandDetail };

export interface RenderOptions {
  noColor?: boolean;
}
