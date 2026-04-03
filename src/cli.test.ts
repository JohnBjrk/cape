import { describe, it, expect } from "bun:test";
import { join } from "node:path";

// Integration tests that spawn the example CLI as a subprocess.
// This validates the full dispatch path including --version, --help,
// completions, and error cases — without needing a real TTY.

const EXAMPLE = join(import.meta.dir, "..", "example", "main.ts");

function run(...args: string[]): { stdout: string; stderr: string; code: number } {
  const proc = Bun.spawnSync(["bun", EXAMPLE, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    // Ensure stdin is not a TTY so prompting is skipped in tests
    stdin: "pipe",
  });
  return {
    stdout: new TextDecoder().decode(proc.stdout).trim(),
    stderr: new TextDecoder().decode(proc.stderr).trim(),
    code: proc.exitCode ?? 0,
  };
}

describe("--version", () => {
  it("prints name and version", () => {
    const { stdout, code } = run("--version");
    expect(stdout).toBe("greet 0.1.0");
    expect(code).toBe(0);
  });

  it("--version before a command name still shows version", () => {
    const { stdout, code } = run("--version", "hello");
    expect(stdout).toBe("greet 0.1.0");
    expect(code).toBe(0);
  });

  it("--version does not run the command", () => {
    const { stdout } = run("--version", "hello", "--name", "World");
    expect(stdout).toBe("greet 0.1.0");
    expect(stdout).not.toContain("Hello");
  });
});

describe("--help at root", () => {
  it("shows the CLI name and lists commands", () => {
    const { stdout, code } = run("--help");
    expect(stdout).toContain("greet");
    expect(stdout).toContain("hello");
    expect(stdout).toContain("farewell");
    expect(code).toBe(0);
  });
});

describe("command dispatch", () => {
  it("runs a command with required flags", () => {
    const { stdout, code } = run("hello", "--name", "Alice");
    expect(stdout).toBe("Hello, Alice!");
    expect(code).toBe(0);
  });

  it("errors on missing required flag (non-TTY)", () => {
    const { stderr, code } = run("hello");
    expect(stderr).toContain("missing required flag --name");
    expect(code).toBe(2);
  });

  it("errors on unknown flag with suggestion", () => {
    const { stderr, code } = run("hello", "--nane", "Alice");
    expect(stderr).toContain("unknown flag --nane");
    expect(stderr).toContain("--name");
    expect(code).toBe(2);
  });

  it("errors on unknown command with suggestion", () => {
    const { stderr, code } = run("helo");
    expect(stderr).toContain("unknown command");
    expect(code).toBe(2);
  });
});

describe("subcommand dispatch", () => {
  it("runs a subcommand", () => {
    const { stdout, code } = run("farewell", "wave", "--name", "Bob");
    expect(stdout).toBe("Goodbye, Bob! 👋");
    expect(code).toBe(0);
  });

  it("shows command help for --help", () => {
    const { stdout } = run("farewell", "--help");
    expect(stdout).toContain("wave");
    expect(stdout).toContain("bow");
  });
});

describe("completions built-in", () => {
  it("completions generate outputs a shell script", () => {
    const { stdout, code } = run("completions", "generate", "--shell", "bash");
    expect(stdout).toContain("__complete");
    expect(stdout).toContain("greet");
    expect(code).toBe(0);
  });
});

describe("__complete mode", () => {
  it("returns command names for empty partial", () => {
    const { stdout } = run("__complete", "0", "");
    const completions = stdout.split("\n").filter(Boolean);
    expect(completions).toContain("hello");
    expect(completions).toContain("farewell");
    expect(completions).toContain("completions");
  });

  it("filters completions by prefix", () => {
    const { stdout } = run("__complete", "0", "h");
    expect(stdout.trim()).toBe("hello");
  });

  it("returns flag names when partial starts with --", () => {
    const { stdout } = run("__complete", "1", "hello", "--");
    const flags = stdout.split("\n").filter(Boolean);
    expect(flags).toContain("--name");
    expect(flags).toContain("--shout");
    expect(flags).toContain("--help");
  });
});
