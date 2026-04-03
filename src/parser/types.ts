// CompletionSource is defined here for Phase 1 and re-exported from the
// completion engine in Phase 4 once that module exists.
export type CompletionSource =
  | { type: "static"; values: string[] }
  | { type: "dynamic"; resolver: string; cacheMs?: number; dependsOn?: string[] };

export interface ArgSchema {
  positionals?: {
    name: string;
    variadic?: boolean;
    complete?: CompletionSource;
  }[];
  flags?: {
    [name: string]: {
      type: "boolean" | "string" | "number";
      alias?: string;
      required?: boolean;
      multiple?: boolean;
      default?: unknown;
      description?: string;
      complete?: CompletionSource;
      hideInSubcommandHelp?: boolean;
    };
  };
}

export interface ParsedArgs {
  flags: Record<string, unknown>;
  positionals: string[];
  passthrough: string[];  // tokens after --
}

export type TokenType = "flag" | "value" | "separator";

export interface Token {
  type: TokenType;
  raw: string;
}
