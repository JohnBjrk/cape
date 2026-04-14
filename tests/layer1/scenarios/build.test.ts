import { test, expect, afterAll } from "bun:test";
import { TestEnv } from "../helpers/env.ts";

// Scenario: cape build, cape install, and running the compiled binary.
// On linux/x64, Bun.build() has a known ELF issue when called from within
// a compiled binary — the test is skipped there if bun is not available as
// a fallback. On macOS and linux with bun installed it runs normally.

const isLinuxX64 = process.platform === "linux" && process.arch === "x64";
const hasBun = !!Bun.which("bun");
const canBuild = !isLinuxX64 || hasBun;

const env = await TestEnv.create();
afterAll(() => env.cleanup());

// Normalise volatile content in command output
const normalizeHome = (s: string) =>
  s
    .replaceAll(env.home, "~")
    // Cape build prints the full output path — shorten to project-relative
    .replace(/\S+\/dist\/my-tool/g, "dist/my-tool")
    // Cape build includes timing info that varies between runs
    .replace(/\[\d+ms\]/g, "[Xms]");

test("cape init for build scenario", async () => {
  const r = await env.exec(["cape", "init", "--name", "my-tool", "--yes"]);
  expect(r.exitCode).toBe(0);

  // Write the filled-in greet command so the compiled binary is interesting
  await env.write(
    "my-tool/commands/greet.ts",
    `import { defineCommand } from "../cli.config.ts";

export const greetCommand = defineCommand({
  name: "greet",
  description: "Greet someone by name",
  schema: {
    flags: {
      name: { type: "string", alias: "n", required: true, description: "Who to greet" },
      loud: { type: "boolean", alias: "l", description: "Shout it" },
    },
  },
  async run(args, runtime) {
    const greeting = \`Hello, \${args.flags.name}!\`;
    runtime.print(args.flags.loud ? greeting.toUpperCase() : greeting);
  },
});
`,
  );

  await env.write(
    "my-tool/main.ts",
    `import { createCli } from "cape";
import config from "./cli.config.ts";
import { helloCommand } from "./commands/hello.ts";
import { greetCommand } from "./commands/greet.ts";

const cli = createCli(config, [helloCommand, greetCommand]);

await cli.run();
`,
  );
});

test.if(canBuild)("cape build produces a binary", async () => {
  const r = await env.exec(["cape", "build"], {
    cwd: "my-tool",
    golden: "build/build",
    normalize: normalizeHome,
  });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("Built:");
  expect(await env.exists("my-tool/dist/my-tool")).toBe(true);
});

test.if(canBuild)("cape install copies binary to home bin dir", async () => {
  const r = await env.exec(["cape", "install"], {
    cwd: "my-tool",
    golden: "build/install",
    normalize: normalizeHome,
  });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("Installed:");
});

test.if(canBuild)("compiled binary runs greet correctly", async () => {
  const r = await env.exec(["./dist/my-tool", "greet", "--name", "Alice"], { cwd: "my-tool" });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("Hello, Alice!");
});

test.if(canBuild)("installed binary runs greet via PATH", async () => {
  const r = await env.exec(["my-tool", "greet", "--name", "Alice"], {
    golden: "build/greet-alice",
  });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("Hello, Alice!");
});

test.if(canBuild)("compiled binary shows help", async () => {
  const r = await env.exec(["./dist/my-tool", "--help"], { cwd: "my-tool" });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("greet");
});

test.if(canBuild)("compiled binary shows version", async () => {
  const r = await env.exec(["./dist/my-tool", "--version"], { cwd: "my-tool" });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("my-tool 0.1.0");
});
