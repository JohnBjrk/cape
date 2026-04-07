import { defineCommand, defineSubcommand } from "../../src/cli.ts";
import { text } from "../../src/prompt/text.ts";
import { confirm } from "../../src/prompt/confirm.ts";
import { NonTtyError } from "../../src/prompt/types.ts";
import { join } from "node:path";
import { existsSync } from "node:fs";

export const commandCommand = defineCommand({
  name: "command",
  description: "Manage commands in the current Cape project",
  subcommands: [
    defineSubcommand({
      name: "add",
      description: "Generate a new command file",
      schema: {
        flags: {
          name: { type: "string", alias: "n", description: "Command name" },
          description: { type: "string", alias: "d", description: "Command description" },
        },
      },
      async run(args, runtime) {
        const cwd = process.cwd();

        if (!existsSync(join(cwd, "cli.config.ts"))) {
          runtime.printError("Error: no cli.config.ts found. Run `cape init --name <name>` first.");
          runtime.exit(1);
        }

        const name = await resolveArg(
          args.flags.name as string | undefined,
          "Command name",
          validateName,
        );
        const description = await resolveArg(
          args.flags.description as string | undefined,
          "Description",
          validateNonEmpty,
        );

        const commandsDir = join(cwd, "commands");
        const outPath = join(commandsDir, `${name}.ts`);

        if (existsSync(outPath)) {
          let overwrite = false;
          try {
            overwrite = await confirm({
              message: `commands/${name}.ts already exists. Overwrite?`,
              default: false,
            });
          } catch (err) {
            if (!(err instanceof NonTtyError)) throw err;
          }
          if (!overwrite) {
            runtime.print("Cancelled.");
            return;
          }
        }

        await Bun.write(outPath, generateCommandFile(name, description));

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
// Helpers
// ---------------------------------------------------------------------------

async function resolveArg(
  value: string | undefined,
  message: string,
  validate: (v: string) => string | undefined,
): Promise<string> {
  if (value) {
    const err = validate(value);
    if (err) throw new Error(`${message}: ${err}`);
    return value;
  }
  try {
    return await text({ message, validate });
  } catch (err) {
    if (err instanceof NonTtyError) {
      process.stderr.write(`Error: ${message} is required. Pass it with a flag.\n`);
      process.exit(1);
    }
    throw err;
  }
}

function validateName(v: string): string | undefined {
  if (!v.trim()) return "Cannot be empty";
  if (!/^[a-z][a-z0-9-]*$/.test(v.trim())) return "Use lowercase letters, numbers, and hyphens";
  return undefined;
}

function validateNonEmpty(v: string): string | undefined {
  return v.trim() ? undefined : "Cannot be empty";
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

function generateCommandFile(name: string, description: string): string {
  const exportName = `${toCamelCase(name)}Command`;
  return [
    `import { defineCommand } from "../cli.config.ts";`,
    ``,
    `export const ${exportName} = defineCommand({`,
    `  name: "${name}",`,
    `  description: ${JSON.stringify(description)},`,
    `  schema: {`,
    `    flags: {`,
    `      // TODO: add flags`,
    `      // example: { type: "string", alias: "e", required: true, description: "An example flag" },`,
    `    },`,
    `  },`,
    `  async run(args, runtime) {`,
    `    // TODO: implement ${name}`,
    `    runtime.print("Running ${name}...");`,
    `  },`,
    `});`,
    ``,
  ].join("\n");
}

function toCamelCase(name: string): string {
  return name
    .split("-")
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}
