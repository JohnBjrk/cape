import type { ParsedArgs } from "../parser/types.ts";

export interface Runtime {
  // Output
  print(text: string): void;
  printError(text: string): void;

  // Input
  args: ParsedArgs;
  env: Record<string, string>;

  // Process
  exit(code: number): never;
}
