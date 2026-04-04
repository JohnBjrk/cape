import { defineCommand } from "../../src/cli.ts";
import { text } from "../../src/prompt/text.ts";
import { confirm } from "../../src/prompt/confirm.ts";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { CAPE_BUNDLE, CAPE_TYPES } from "../src/embedded.ts";

export const initCommand = defineCommand({
  name: "init",
  description: "Scaffold a new Cape-based CLI project",
  schema: {
    positionals: [{ name: "name" }],
    flags: {
      yes: { type: "boolean", alias: "y", description: "Skip confirmation prompts" },
    },
  },
  async run(args, runtime) {
    let name = args.positionals[0];

    if (!name) {
      if (!process.stdin.isTTY) {
        runtime.printError("Error: project name is required in non-interactive mode.");
        runtime.exit(1);
      }
      name = await text({
        message: "Project name",
        validate: (v) => {
          if (!v.trim()) return "Name cannot be empty";
          if (!/^[a-z][a-z0-9-]*$/.test(v.trim())) return "Use lowercase letters, numbers, and hyphens (e.g. my-cli)";
          return undefined;
        },
      });
    }

    name = name.trim();

    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      runtime.printError(`Error: invalid project name "${name}". Use lowercase letters, numbers, and hyphens.`);
      runtime.exit(1);
    }

    const projectDir = join(process.cwd(), name);

    if (existsSync(projectDir)) {
      runtime.printError(`Error: directory "${name}/" already exists.`);
      runtime.exit(1);
    }

    if (process.stdin.isTTY && !args.flags.yes) {
      const ok = await confirm({
        message: `Create Cape CLI project in ./${name}/?`,
        default: true,
      });
      if (!ok) {
        runtime.print("Cancelled.");
        return;
      }
    }

    runtime.print(`\nScaffolding ${name}...`);

    // Create directory structure
    await mkdir(join(projectDir, "commands"), { recursive: true });
    await mkdir(join(projectDir, "node_modules", "cape"), { recursive: true });

    // Write all files in parallel
    await Promise.all([
      Bun.write(join(projectDir, "cli.config.ts"),              cliConfigTemplate(name)),
      Bun.write(join(projectDir, "main.ts"),                    mainTemplate(name)),
      Bun.write(join(projectDir, "commands", "hello.ts"),       helloCommandTemplate()),
      Bun.write(join(projectDir, "tsconfig.json"),              tsconfigContent()),
      Bun.write(join(projectDir, ".gitignore"),                 gitignoreContent()),
      // Cape runtime — enables `import { ... } from "cape"` in the project
      Bun.write(join(projectDir, "node_modules", "cape", "package.json"), capePackageJson()),
      Bun.write(join(projectDir, "node_modules", "cape", "index.js"),     CAPE_BUNDLE || capeBundleMissing()),
      Bun.write(join(projectDir, "node_modules", "cape", "index.d.ts"),   CAPE_TYPES),
    ]);

    runtime.output.success(`Created ${name}/`);
    runtime.print("");
    runtime.print("Next steps:");
    runtime.print(`  cd ${name}`);
    runtime.print(`  cape run --help            # run in dev mode`);
    runtime.print(`  cape command add           # add a new command`);
    runtime.print(`  cape build                 # compile to a standalone binary`);
    runtime.print("");
  },
});

// ---------------------------------------------------------------------------
// File templates
// ---------------------------------------------------------------------------

function cliConfigTemplate(name: string): string {
  return `import { defineConfig } from "cape";

export default defineConfig({
  name: "${name}",
  displayName: "${toDisplayName(name)}",
  version: "0.1.0",
  description: "A CLI built with Cape",
});
`;
}

function mainTemplate(name: string): string {
  return `import { createCli } from "cape";
import config from "./cli.config.ts";
import { helloCommand } from "./commands/hello.ts";

const cli = createCli(config, [helloCommand]);

await cli.run();
`;
}

function helloCommandTemplate(): string {
  return `import { defineCommand } from "cape";

export const helloCommand = defineCommand({
  name: "hello",
  description: "Say hello",
  schema: {
    flags: {
      name: {
        type: "string",
        alias: "n",
        required: true,
        description: "Who to greet",
      },
    },
  },
  async run(args, runtime) {
    runtime.print(\`Hello, \${args.flags.name}!\`);
  },
});
`;
}

function tsconfigContent(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        types: ["bun-types"],
      },
    },
    null,
    2,
  ) + "\n";
}

function gitignoreContent(): string {
  return `# Compiled binaries
dist/

# Credentials — never commit
credentials.toml

# OS
.DS_Store
`;
}

function capePackageJson(): string {
  return JSON.stringify(
    { name: "cape", version: "0.1.0", type: "module", main: "index.js", types: "index.d.ts" },
    null,
    2,
  ) + "\n";
}

function capeBundleMissing(): string {
  return `// Cape runtime bundle not available.
// Run the cape binary (cape run / cape build) to regenerate this file.
throw new Error("Cape runtime bundle is missing. Run \`cape run\` to regenerate node_modules/cape/.");
`;
}

function toDisplayName(name: string): string {
  return name
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}
