import { test, expect, afterAll } from "bun:test";
import { TestEnv } from "../helpers/env.ts";

// Scenario: verify that the runtime.prompt API examples used in docs/api/prompt.md
// actually compile and run correctly. Each command uses runtime.prompt.* in its
// source, catching any API shape changes at test time rather than silently leaving
// docs wrong.
//
// Prompts require a TTY — the test env runs without one. Commands are structured
// so that when flags are provided the prompt path is not reached, letting the
// test verify the command runs to completion. The prompt API is still referenced
// in source, so any signature change breaks the test when Cape loads the file.

const env = await TestEnv.create();
afterAll(() => env.cleanup());

test("setup: cape init", async () => {
  const r = await env.exec(["cape", "init", "--name", "my-tool", "--yes"]);
  expect(r.exitCode).toBe(0);
});

// ---------------------------------------------------------------------------
// text()
// ---------------------------------------------------------------------------

test("text prompt — flag bypasses prompt", async () => {
  await env.write(
    "my-tool/commands/create.ts",
    `import { defineCommand } from "../cli.config.ts";

export const createCommand = defineCommand({
  name: "create",
  description: "Create a new service",
  schema: {
    flags: {
      name: { type: "string", description: "Service name" },
    },
  },
  async run(args, runtime) {
    const name = args.flags.name ?? await runtime.prompt.text({
      message: "Service name",
      validate: (v) => {
        if (!v.trim()) return "Name cannot be empty";
        if (!/^[a-z][a-z0-9-]*$/.test(v)) return "Use lowercase letters, numbers, and hyphens";
      },
    });
    runtime.output.success(\`Created service "\${name}"\`);
  },
});
`,
  );
  await env.snapshot("my-tool/commands/create.ts", "api/prompt/create.ts");

  await env.write(
    "my-tool/main.ts",
    `import { createCli } from "cape";
import config from "./cli.config.ts";
import { createCommand } from "./commands/create.ts";

const cli = createCli(config, [createCommand]);
await cli.run();
`,
  );

  const r = await env.exec(["cape", "run", "--", "create", "--name", "api-service"], {
    cwd: "my-tool",
  });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain('Created service "api-service"');
});

// ---------------------------------------------------------------------------
// confirm() via prompt: true on boolean flag
// ---------------------------------------------------------------------------

test("confirm prompt — prompt:true boolean, flag bypasses prompt", async () => {
  await env.write(
    "my-tool/commands/wipe.ts",
    `import { defineCommand } from "../cli.config.ts";

export const wipeCommand = defineCommand({
  name: "wipe",
  description: "Delete all data in an environment",
  schema: {
    flags: {
      env:   { type: "string",  required: true, description: "Target environment" },
      force: { type: "boolean", prompt: true,   description: "Confirm deletion" },
    },
  },
  async run(args, runtime) {
    if (!args.flags.force) {
      runtime.print("Aborted.");
      return;
    }
    runtime.output.success(\`Wiped \${args.flags.env}\`);
  },
});
`,
  );
  await env.snapshot("my-tool/commands/wipe.ts", "api/prompt/wipe.ts");

  await env.write(
    "my-tool/main.ts",
    `import { createCli } from "cape";
import config from "./cli.config.ts";
import { wipeCommand } from "./commands/wipe.ts";

const cli = createCli(config, [wipeCommand]);
await cli.run();
`,
  );

  // --force skips the confirm prompt
  const r = await env.exec(["cape", "run", "--", "wipe", "--env", "staging", "--force"], {
    cwd: "my-tool",
  });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("Wiped staging");
});

// ---------------------------------------------------------------------------
// select() via required flag + static completion
// ---------------------------------------------------------------------------

test("select prompt — required flag with static completion", async () => {
  await env.write(
    "my-tool/commands/release.ts",
    `import { defineCommand } from "../cli.config.ts";

export const releaseCommand = defineCommand({
  name: "release",
  description: "Release to an environment",
  schema: {
    flags: {
      env: {
        type: "string",
        required: true,
        description: "Target environment",
        complete: {
          type: "static",
          values: ["development", "staging", "production"],
        },
      },
    },
  },
  async run(args, runtime) {
    runtime.output.success(\`Released to \${args.flags.env}\`);
  },
});
`,
  );
  await env.snapshot("my-tool/commands/release.ts", "api/prompt/release.ts");

  await env.write(
    "my-tool/main.ts",
    `import { createCli } from "cape";
import config from "./cli.config.ts";
import { releaseCommand } from "./commands/release.ts";

const cli = createCli(config, [releaseCommand]);
await cli.run();
`,
  );

  const r = await env.exec(["cape", "run", "--", "release", "--env", "staging"], {
    cwd: "my-tool",
  });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("Released to staging");
});

// ---------------------------------------------------------------------------
// multiSelect() called directly, flag bypasses it
// ---------------------------------------------------------------------------

test("multiSelect prompt — flag bypasses prompt", async () => {
  await env.write(
    "my-tool/commands/tag.ts",
    `import { defineCommand } from "../cli.config.ts";

export const tagCommand = defineCommand({
  name: "tag",
  description: "Apply labels to a service",
  schema: {
    flags: {
      service: { type: "string", required: true, description: "Target service" },
      label:   { type: "string", multiple: true, description: "Labels to apply (repeatable)" },
    },
  },
  async run(args, runtime) {
    const labels = args.provided.has("label")
      ? args.flags.label
      : await runtime.prompt.multiSelect({
          message: "Select labels to apply",
          choices: ["stable", "canary", "deprecated", "internal", "public", "beta"],
        });

    if (labels.length === 0) {
      runtime.print("No labels applied.");
      return;
    }
    runtime.output.success(\`Applied to \${args.flags.service}: \${labels.join(", ")}\`);
  },
});
`,
  );
  await env.snapshot("my-tool/commands/tag.ts", "api/prompt/tag.ts");

  await env.write(
    "my-tool/main.ts",
    `import { createCli } from "cape";
import config from "./cli.config.ts";
import { tagCommand } from "./commands/tag.ts";

const cli = createCli(config, [tagCommand]);
await cli.run();
`,
  );

  const r = await env.exec(
    ["cape", "run", "--", "tag", "--service", "api", "--label", "stable", "--label", "canary"],
    { cwd: "my-tool" },
  );
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("stable");
  expect(r.stdout).toContain("canary");
});

// ---------------------------------------------------------------------------
// autocomplete() called directly, flag bypasses it
// ---------------------------------------------------------------------------

test("autocomplete prompt — flag bypasses prompt", async () => {
  await env.write(
    "my-tool/commands/logs.ts",
    `import { defineCommand } from "../cli.config.ts";

export const logsCommand = defineCommand({
  name: "logs",
  description: "Tail logs for a service",
  schema: {
    flags: {
      service: { type: "string", description: "Service name" },
    },
  },
  async run(args, runtime) {
    const service = args.flags.service ?? await runtime.prompt.autocomplete({
      message: "Service",
      choices: async (query, signal) => {
        // In production this would fetch from an API
        const all = ["api-gateway", "auth-service", "billing", "data-pipeline", "frontend"];
        return all.filter((s) => s.includes(query));
      },
    });
    runtime.output.success(\`Tailing logs for \${service}...\`);
  },
});
`,
  );
  await env.snapshot("my-tool/commands/logs.ts", "api/prompt/logs.ts");

  await env.write(
    "my-tool/main.ts",
    `import { createCli } from "cape";
import config from "./cli.config.ts";
import { logsCommand } from "./commands/logs.ts";

const cli = createCli(config, [logsCommand]);
await cli.run();
`,
  );

  const r = await env.exec(["cape", "run", "--", "logs", "--service", "api-gateway"], {
    cwd: "my-tool",
  });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("api-gateway");
});
