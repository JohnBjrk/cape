import { test, expect, afterAll } from "bun:test";
import { TestEnv } from "../helpers/env.ts";

// Scenario: the full quickstart flow — init, run, command add.
// Tests run sequentially; each builds on the state left by the previous.

const env = await TestEnv.create();
afterAll(() => env.cleanup());

test("cape init scaffolds a project", async () => {
  const r = await env.exec(["cape", "init", "--name", "my-tool", "--yes"], {
    golden: "quickstart/init",
  });
  expect(r.exitCode).toBe(0);
  expect(await env.exists("my-tool/cli.config.ts")).toBe(true);
  expect(await env.exists("my-tool/main.ts")).toBe(true);
  expect(await env.exists("my-tool/commands/hello.ts")).toBe(true);
  await env.snapshot("my-tool/cli.config.ts", "quickstart/cli.config.ts");
  await env.snapshot("my-tool/main.ts", "quickstart/main.ts");
  await env.snapshot("my-tool/commands/hello.ts", "quickstart/commands/hello.ts");
});

test("cape run executes a command", async () => {
  const r = await env.exec(["cape", "run", "--", "hello", "--name", "World"], {
    cwd: "my-tool",
    golden: "quickstart/run",
  });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("Hello, World!");
});

test("cape run shows help when no command given", async () => {
  const r = await env.exec(["cape", "run", "--"], { cwd: "my-tool" });
  expect(r.stdout).toContain("hello");
});

test("cape command add generates a command file", async () => {
  const r = await env.exec(
    ["cape", "command", "add", "--name", "greet", "--description", "Greet someone"],
    { cwd: "my-tool", golden: "quickstart/command-add" },
  );
  expect(r.exitCode).toBe(0);
  expect(await env.exists("my-tool/commands/greet.ts")).toBe(true);
  await env.snapshot("my-tool/commands/greet.ts", "quickstart/commands/greet.ts");
});

test("generated command file has correct structure", async () => {
  const src = await env.read("my-tool/commands/greet.ts");
  expect(src).toContain('name: "greet"');
  expect(src).toContain('"Greet someone"');
  expect(src).toContain("defineCommand");
});
