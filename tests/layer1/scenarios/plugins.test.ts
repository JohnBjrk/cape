import { test, expect, afterAll } from "bun:test";
import { join } from "node:path";
import { TestEnv } from "../helpers/env.ts";
import { snapshot } from "../helpers/golden.ts";

// Scenario: project-local plugin flow.
//
// A workspace directory holds a .my-tool.toml that declares a pluginDirs entry.
// plugin create is called with --location ./plugins to select that directory
// non-interactively (no TTY prompt needed).

const isLinuxX64 = process.platform === "linux" && process.arch === "x64";
const hasBun = !!Bun.which("bun");
const canBuild = !isLinuxX64 || hasBun;

const env = await TestEnv.create();
afterAll(() => env.cleanup());

// workspace/ lives alongside my-tool/ inside env.root
const WORKSPACE = "workspace";

test("cape init for plugins scenario", async () => {
  const r = await env.exec(["cape", "init", "--name", "my-tool", "--yes"]);
  expect(r.exitCode).toBe(0);

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

test.if(canBuild)("cape build and install", async () => {
  const build = await env.exec(["cape", "build"], { cwd: "my-tool" });
  expect(build.exitCode).toBe(0);

  const install = await env.exec(["cape", "install"], { cwd: "my-tool" });
  expect(install.exitCode).toBe(0);
});

test.if(canBuild)("plugin create with --location creates a local plugin", async () => {
  const tomlContent = `[my-tool]
pluginDirs = ["./plugins"]
`;
  await env.write(`${WORKSPACE}/.my-tool.toml`, tomlContent);
  await snapshot("plugins/my-tool.toml", tomlContent);

  const r = await env.exec(
    [
      "my-tool",
      "plugin",
      "create",
      "--name",
      "status",
      "--description",
      "Show deployment status",
      "--location",
      "./plugins",
    ],
    { cwd: WORKSPACE, golden: "plugins/create" },
  );
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain('Created plugin "status"');

  await env.snapshot(`${WORKSPACE}/plugins/status/status.ts`, "plugins/status.ts");
  await env.snapshot(
    `${WORKSPACE}/plugins/status/status.plugin.toml`,
    "plugins/status.plugin.toml",
  );
});

test.if(canBuild)("filled-in status plugin runs correctly", async () => {
  const filledIn = `import { defineCommand } from "../../.my-tool/index.ts";

export default defineCommand({
  name: "status",
  description: "Show deployment status",
  schema: {
    flags: {
      env: { type: "string", alias: "e", default: "staging", description: "Target environment" },
    },
  },
  async run(args, runtime) {
    runtime.print(\`Checking status for \${args.flags.env}...\`);
  },
});
`;
  await env.write(`${WORKSPACE}/plugins/status/status.ts`, filledIn);
  await snapshot("plugins/status-filled.ts", filledIn);

  const r1 = await env.exec(["my-tool", "status"], {
    cwd: WORKSPACE,
    golden: "plugins/status",
  });
  expect(r1.exitCode).toBe(0);
  expect(r1.stdout).toContain("Checking status for staging...");

  const r2 = await env.exec(["my-tool", "status", "--env", "production"], {
    cwd: WORKSPACE,
    golden: "plugins/status-env",
  });
  expect(r2.exitCode).toBe(0);
  expect(r2.stdout).toContain("Checking status for production...");
});
