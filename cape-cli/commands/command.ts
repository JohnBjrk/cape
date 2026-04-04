import { defineCommand, defineSubcommand } from "../../src/cli.ts";
import { text } from "../../src/prompt/text.ts";
import { confirm } from "../../src/prompt/confirm.ts";
import { multiSelect } from "../../src/prompt/multi-select.ts";
import { join } from "node:path";
import { existsSync } from "node:fs";

export const commandCommand = defineCommand({
  name: "command",
  description: "Manage commands in the current Cape project",
  subcommands: [
    defineSubcommand({
      name: "add",
      description: "Interactively generate a new command file",
      schema: {
        positionals: [{ name: "name" }],
      },
      async run(args, runtime) {
        if (!process.stdin.isTTY) {
          runtime.printError("Error: `cape command add` requires an interactive terminal.");
          runtime.exit(1);
        }

        const cwd = process.cwd();

        // Verify we're inside a Cape project
        if (!existsSync(join(cwd, "cli.config.ts"))) {
          runtime.printError("Error: no cli.config.ts found. Run `cape init <name>` first.");
          runtime.exit(1);
        }

        // --- Collect info ---

        let name = args.positionals[0]?.trim() ?? "";
        if (!name) {
          name = await text({
            message: "Command name",
            validate: (v) => {
              if (!v.trim()) return "Name cannot be empty";
              if (!/^[a-z][a-z0-9-]*$/.test(v.trim())) return "Use lowercase letters, numbers, and hyphens";
              return undefined;
            },
          });
          name = name.trim();
        }

        const description = await text({
          message: "Description",
          validate: (v) => v.trim() ? undefined : "Description cannot be empty",
        });

        const flagTypes = await multiSelect({
          message: "Add flags? (Space to toggle, Enter to continue)",
          choices: ["string flag", "boolean flag", "number flag"],
          defaults: [],
        });

        const flags: FlagSpec[] = [];
        for (const flagType of flagTypes) {
          const flagName = await text({
            message: `${flagType} — flag name (without --)`,
            validate: (v) => /^[a-z][a-z0-9-]*$/.test(v.trim()) ? undefined : "Use lowercase letters, numbers, hyphens",
          });
          const flagDesc = await text({
            message: `${flagName} — description`,
          });
          const required = flagType !== "boolean flag" && await confirm({
            message: `Is --${flagName.trim()} required?`,
            default: false,
          });
          flags.push({
            name: flagName.trim(),
            type: flagType.split(" ")[0] as "string" | "boolean" | "number",
            description: flagDesc,
            required: required === true,
          });
        }

        // --- Generate file ---

        const commandsDir = join(cwd, "commands");
        const outPath = join(commandsDir, `${name}.ts`);

        if (existsSync(outPath)) {
          const overwrite = await confirm({
            message: `commands/${name}.ts already exists. Overwrite?`,
            default: false,
          });
          if (!overwrite) {
            runtime.print("Cancelled.");
            return;
          }
        }

        await Bun.write(outPath, generateCommandFile(name, description, flags));

        runtime.output.success(`Created commands/${name}.ts`);
        runtime.print("");
        runtime.print("Add it to your CLI in main.ts:");
        runtime.print(`  import { ${toCamelCase(name)}Command } from "./commands/${name}.ts";`);
        runtime.print(`  const cli = createCli(config, [..., ${toCamelCase(name)}Command]);`);
        runtime.print("");
      },
    }),
  ],
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FlagSpec {
  name: string;
  type: "string" | "boolean" | "number";
  description: string;
  required: boolean;
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

function generateCommandFile(name: string, description: string, flags: FlagSpec[]): string {
  const exportName = `${toCamelCase(name)}Command`;
  const hasFlags = flags.length > 0;

  const lines: string[] = [
    `import { defineCommand } from "cape";`,
    "",
    `export const ${exportName} = defineCommand({`,
    `  name: "${name}",`,
    `  description: ${JSON.stringify(description)},`,
  ];

  if (hasFlags) {
    lines.push(`  schema: {`);
    lines.push(`    flags: {`);
    for (const flag of flags) {
      lines.push(`      ${flag.name}: {`);
      lines.push(`        type: "${flag.type}",`);
      lines.push(`        description: ${JSON.stringify(flag.description)},`);
      if (flag.required) lines.push(`        required: true,`);
      lines.push(`      },`);
    }
    lines.push(`    },`);
    lines.push(`  },`);
  }

  lines.push(`  async run(args, runtime) {`);
  lines.push(`    // TODO: implement ${name}`);

  if (hasFlags) {
    for (const flag of flags) {
      lines.push(`    const ${toCamelCase(flag.name)} = args.flags.${flag.name};`);
    }
    lines.push(`    runtime.print(\`Running ${name}...\`);`);
  } else {
    lines.push(`    runtime.print("Running ${name}...");`);
  }

  lines.push(`  },`);
  lines.push(`});`);
  lines.push(``);

  return lines.join("\n");
}

function toCamelCase(name: string): string {
  return name
    .split("-")
    .map((part, i) => i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
