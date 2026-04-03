import type { ParsedArgs } from "../parser/types.ts";
import type { Runtime } from "./types.ts";

interface MockRuntimeOptions {
  args?: Partial<ParsedArgs>;
  env?: Record<string, string>;
}

export class MockRuntime implements Runtime {
  args: ParsedArgs;
  env: Record<string, string>;

  readonly printed: string[] = [];
  readonly errors: string[] = [];
  exitCode: number | undefined;

  constructor(options: MockRuntimeOptions = {}) {
    this.args = {
      flags: {},
      positionals: [],
      passthrough: [],
      ...options.args,
    };
    this.env = options.env ?? {};
  }

  print(text: string): void {
    this.printed.push(text);
  }

  printError(text: string): void {
    this.errors.push(text);
  }

  exit(code: number): never {
    this.exitCode = code;
    throw new MockExitError(code);
  }
}

export class MockExitError extends Error {
  constructor(public readonly code: number) {
    super(`Process exited with code ${code}`);
  }
}
