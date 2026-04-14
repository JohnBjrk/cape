import { test, expect, afterAll } from "bun:test";
import { TestEnv } from "../helpers/env.ts";

// Scenario: verify that the runtime.output API examples used in docs/api/output.md
// actually compile and run correctly. Command files are golden-snapshotted so the
// docs can reference them directly — any API change that breaks these commands will
// also break the docs examples.

const env = await TestEnv.create();
afterAll(() => env.cleanup());

test("setup: cape init", async () => {
  const r = await env.exec(["cape", "init", "--name", "my-tool", "--yes"]);
  expect(r.exitCode).toBe(0);
});

// ---------------------------------------------------------------------------
// table() and list()
// ---------------------------------------------------------------------------

test("table and list commands", async () => {
  await env.write(
    "my-tool/commands/services.ts",
    `import { defineCommand } from "../cli.config.ts";

export const servicesCommand = defineCommand({
  name: "services",
  description: "List running services",
  async run(_args, runtime) {
    runtime.output.table([
      { Name: "api",      Status: "running", Replicas: 3 },
      { Name: "worker",   Status: "stopped", Replicas: 0 },
      { Name: "frontend", Status: "running", Replicas: 2 },
    ]);
    runtime.print("");
    runtime.output.list(["api", "worker", "frontend"]);
  },
});
`,
  );
  await env.snapshot("my-tool/commands/services.ts", "api/output/services.ts");

  await env.write(
    "my-tool/main.ts",
    `import { createCli } from "cape";
import config from "./cli.config.ts";
import { servicesCommand } from "./commands/services.ts";

const cli = createCli(config, [servicesCommand]);
await cli.run();
`,
  );

  const r = await env.exec(["cape", "run", "--", "services"], {
    cwd: "my-tool",
    golden: "api/output/services",
  });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("api");
  expect(r.stdout).toContain("worker");
  expect(r.stdout).toContain("frontend");
});

// ---------------------------------------------------------------------------
// success() and warn()
// ---------------------------------------------------------------------------

test("success and warn commands", async () => {
  await env.write(
    "my-tool/commands/check.ts",
    `import { defineCommand } from "../cli.config.ts";

export const checkCommand = defineCommand({
  name: "check",
  description: "Check service health",
  schema: {
    flags: {
      service: { type: "string", required: true, description: "Service name" },
    },
  },
  async run(args, runtime) {
    runtime.output.success(\`\${args.flags.service} is running\`);
    runtime.output.warn("1 unhealthy replica detected — consider scaling up");
  },
});
`,
  );
  await env.snapshot("my-tool/commands/check.ts", "api/output/check.ts");

  await env.write(
    "my-tool/main.ts",
    `import { createCli } from "cape";
import config from "./cli.config.ts";
import { checkCommand } from "./commands/check.ts";

const cli = createCli(config, [checkCommand]);
await cli.run();
`,
  );

  const r = await env.exec(["cape", "run", "--", "check", "--service", "api"], {
    cwd: "my-tool",
    golden: "api/output/check",
  });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("api is running");
  expect(r.stderr).toContain("unhealthy");
});

// ---------------------------------------------------------------------------
// withSpinner()
// ---------------------------------------------------------------------------

test("spinner command", async () => {
  await env.write(
    "my-tool/commands/deploy.ts",
    `import { defineCommand } from "../cli.config.ts";

export const deployCommand = defineCommand({
  name: "deploy",
  description: "Deploy a service",
  schema: {
    flags: {
      service: { type: "string", required: true, description: "Service to deploy" },
      env:     { type: "string", default: "staging", description: "Target environment" },
    },
  },
  async run(args, runtime) {
    const result = await runtime.output.withSpinner(
      \`Deploying \${args.flags.service} to \${args.flags.env}...\`,
      async (spinner) => {
        spinner.update("Building image...");
        await Bun.sleep(0);
        spinner.update("Pushing to registry...");
        await Bun.sleep(0);
        return { tag: "v1.4.2" };
      },
    );
    runtime.output.success(
      \`Deployed \${args.flags.service} \${result.tag} to \${args.flags.env}\`,
    );
  },
});
`,
  );
  await env.snapshot("my-tool/commands/deploy.ts", "api/output/deploy.ts");

  await env.write(
    "my-tool/main.ts",
    `import { createCli } from "cape";
import config from "./cli.config.ts";
import { deployCommand } from "./commands/deploy.ts";

const cli = createCli(config, [deployCommand]);
await cli.run();
`,
  );

  const r = await env.exec(["cape", "run", "--", "deploy", "--service", "api"], {
    cwd: "my-tool",
    golden: "api/output/deploy",
  });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("Deployed api");
});

// ---------------------------------------------------------------------------
// withProgressBar()
// ---------------------------------------------------------------------------

test("progress bar command", async () => {
  await env.write(
    "my-tool/commands/migrate.ts",
    `import { defineCommand } from "../cli.config.ts";

export const migrateCommand = defineCommand({
  name: "migrate",
  description: "Run database migrations",
  schema: {
    flags: {
      steps: { type: "number", default: 3, description: "Number of migrations to run" },
    },
  },
  async run(args, runtime) {
    const migrations = Array.from(
      { length: args.flags.steps },
      (_, i) => \`migration_00\${i + 1}\`,
    );
    await runtime.output.withProgressBar(migrations.length, async (tick) => {
      for (const migration of migrations) {
        await Bun.sleep(0);
        runtime.log.verbose(\`Applied \${migration}\`);
        tick();
      }
    });
    runtime.output.success(\`Applied \${migrations.length} migrations\`);
  },
});
`,
  );
  await env.snapshot("my-tool/commands/migrate.ts", "api/output/migrate.ts");

  await env.write(
    "my-tool/main.ts",
    `import { createCli } from "cape";
import config from "./cli.config.ts";
import { migrateCommand } from "./commands/migrate.ts";

const cli = createCli(config, [migrateCommand]);
await cli.run();
`,
  );

  const r = await env.exec(["cape", "run", "--", "migrate"], {
    cwd: "my-tool",
    golden: "api/output/migrate",
  });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("Applied 3 migrations");
});

// ---------------------------------------------------------------------------
// json() and --json flag
// ---------------------------------------------------------------------------

test("json output command — normal and --json mode", async () => {
  await env.write(
    "my-tool/commands/info.ts",
    `import { defineCommand } from "../cli.config.ts";

export const infoCommand = defineCommand({
  name: "info",
  description: "Show service details",
  schema: {
    flags: {
      service: { type: "string", required: true, description: "Service name" },
    },
  },
  async run(args, runtime) {
    runtime.output.json({
      name: args.flags.service,
      status: "running",
      version: "1.4.2",
      uptime: "3d 14h",
    });
  },
});
`,
  );
  await env.snapshot("my-tool/commands/info.ts", "api/output/info.ts");

  await env.write(
    "my-tool/main.ts",
    `import { createCli } from "cape";
import config from "./cli.config.ts";
import { infoCommand } from "./commands/info.ts";

const cli = createCli(config, [infoCommand]);
await cli.run();
`,
  );

  // Normal mode: json() prints directly
  const r1 = await env.exec(["cape", "run", "--", "info", "--service", "api"], {
    cwd: "my-tool",
    golden: "api/output/info",
  });
  expect(r1.exitCode).toBe(0);
  expect(JSON.parse(r1.stdout)).toMatchObject({ name: "api", status: "running" });

  // --json mode: output is wrapped by the framework
  const r2 = await env.exec(["cape", "run", "--", "info", "--service", "api", "--json"], {
    cwd: "my-tool",
    golden: "api/output/info-json",
  });
  expect(r2.exitCode).toBe(0);
  expect(JSON.parse(r2.stdout)).toMatchObject({ name: "api", status: "running" });
});
