import { test, expect, afterAll } from "bun:test";
import { join } from "node:path";
import { TestEnv } from "../helpers/env.ts";
import { snapshot } from "../helpers/golden.ts";

// Scenario: plugin create, fill in, and run via the installed binary.
//
// Plugin create is run from env.root (no .my-tool.toml nearby) so there is
// only one location option — user-level ~/.config/my-tool/plugins/ — and the
// prompt is skipped automatically (non-interactive safe).

const isLinuxX64 = process.platform === "linux" && process.arch === "x64";
const hasBun = !!Bun.which("bun");
const canBuild = !isLinuxX64 || hasBun;

const env = await TestEnv.create();
afterAll(() => env.cleanup());

const normalizeHome = (s: string) => s.replaceAll(env.home, "~");

// Absolute path to the user-level plugin directory (mirrors what my-tool uses)
const pluginDir = join(env.home, ".config", "my-tool", "plugins", "status");

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

test.if(canBuild)("plugin create scaffolds a plugin non-interactively", async () => {
  // Run from env.root — no .my-tool.toml in any parent, so only the
  // user-level directory is offered and auto-selected (no prompt).
  const r = await env.exec(
    ["my-tool", "plugin", "create", "--name", "status", "--description", "Show deployment status"],
    { golden: "plugins/create", normalize: normalizeHome },
  );
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain('Created plugin "status"');

  // Snapshot the generated scaffold files
  const scaffoldTs = await Bun.file(join(pluginDir, "status.ts")).text();
  await snapshot("plugins/status.ts", scaffoldTs);

  const scaffoldToml = await Bun.file(join(pluginDir, "status.plugin.toml")).text();
  await snapshot("plugins/status.plugin.toml", scaffoldToml);
});

test.if(canBuild)("filled-in status plugin runs correctly", async () => {
  const filledIn = `const defineCommand = (def: any) => def;

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
  await Bun.write(join(pluginDir, "status.ts"), filledIn);
  await snapshot("plugins/status-filled.ts", filledIn);

  const r1 = await env.exec(["my-tool", "status"], { golden: "plugins/status" });
  expect(r1.exitCode).toBe(0);
  expect(r1.stdout).toContain("Checking status for staging...");

  const r2 = await env.exec(["my-tool", "status", "--env", "production"], {
    golden: "plugins/status-env",
  });
  expect(r2.exitCode).toBe(0);
  expect(r2.stdout).toContain("Checking status for production...");
});
