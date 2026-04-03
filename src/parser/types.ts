/** Context passed to dynamic completion fetchers. */
export interface CompletionCtx {
  /** The partial word being completed. */
  partial: string;
  /** Flag values already typed on the command line (best-effort, may be incomplete). */
  flags: Record<string, unknown>;
}

export type CompletionSource =
  | { type: "static"; values: string[] }
  | {
      type: "dynamic";
      fetch: (ctx: CompletionCtx) => Promise<string[]>;
      /** How long to cache results (ms). Omit to disable caching. */
      cacheMs?: number;
      /** Abort and return [] if fetch takes longer than this (ms). Default: 5000. */
      timeoutMs?: number;
      /** Other flag names whose values should be available in ctx.flags before fetching. */
      dependsOn?: string[];
    };

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
