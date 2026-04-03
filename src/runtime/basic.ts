import type { ParsedArgs } from "../parser/types.ts";
import type { Runtime } from "./types.ts";

/**
 * The real runtime used when a command is actually executed.
 * Wraps process.stdout / stderr / exit.
 */
export class BasicRuntime implements Runtime {
  args: ParsedArgs;
  env: Record<string, string>;

  constructor(args: ParsedArgs, env: Record<string, string>) {
    this.args = args;
    this.env = env;
  }

  print(text: string): void {
    process.stdout.write(text + "\n");
  }

  printError(text: string): void {
    process.stderr.write(text + "\n");
  }

  exit(code: number): never {
    process.exit(code);
  }
}
