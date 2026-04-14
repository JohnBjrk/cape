import { join, relative, isAbsolute } from "node:path";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import type { CommandDef, SubcommandDef } from "../cli.ts";
import type { Runtime } from "../runtime/types.ts";
import type { ParsedArgs, ConfigSchema, ConfigField, CompletionChoice } from "../parser/types.ts";
import { discoverPlugins } from "../loader/discover.ts";
import { readFrameworkConfig, findLocalConfigDir } from "../runtime/config.ts";
import { xdgConfigHome, expandHome } from "../runtime/fs.ts";
import { FRAMEWORK_VERSION } from "../loader/load.ts";
import { CAPE_TYPES } from "../embedded.ts";
import { text } from "../prompt/text.ts";
import { NonTtyError } from "../prompt/types.ts";

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Returns the built-in `plugin` command, pre-bound to the CLI name and any
 * plugin dirs declared in CliConfig. Injected into every Cape-based CLI.
 */
export function createPluginCommand(
  cliName: string,
  codePluginDirs: string[],
  version: string,
  configSchema: ConfigSchema,
): CommandDef {
  return {
    name: "plugin",
    description: "Manage plugins",
    subcommands: [
      listSubcommand(cliName, codePluginDirs),
      createSubcommand(cliName, version, configSchema),
      initSubcommand(cliName, version, configSchema),
    ],
  };
}

// ---------------------------------------------------------------------------
// plugin list
// ---------------------------------------------------------------------------

function listSubcommand(cliName: string, codePluginDirs: string[]): SubcommandDef {
  return {
    name: "list",
    description: "List all discovered plugins",
    async run(_args: ParsedArgs, runtime: Runtime): Promise<void> {
      const frameworkCfg = await readFrameworkConfig(cliName);
      const tomlDirs = (frameworkCfg["pluginDirs"] as string[] | undefined) ?? [];
      const dirs = pluginDirs(cliName, codePluginDirs, tomlDirs);

      const plugins = await discoverPlugins(dirs, { includeDisabled: true });

      if (plugins.length === 0) {
        runtime.print("No plugins found.");
        runtime.print("");
        runtime.print("Searched:");
        for (const dir of dirs) runtime.print(`  ${dir}`);
        return;
      }

      runtime.output.table(
        plugins.map((p) => ({
          Name: p.manifest.name,
          Description: p.manifest.description,
          Location: p.pluginDir,
          Status: p.manifest.enabled ? "enabled" : "disabled",
        })),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// plugin create
// ---------------------------------------------------------------------------

function createSubcommand(
  cliName: string,
  version: string,
  configSchema: ConfigSchema,
): SubcommandDef {
  return {
    name: "create",
    description: "Scaffold a new plugin",
    schema: {
      flags: {
        name: { type: "string", alias: "n", description: "Plugin name" },
        description: { type: "string", alias: "d", description: "Plugin description" },
        location: {
          type: "string",
          alias: "l",
          required: true,
          description: "Directory to create the plugin in",
          complete: {
            type: "dynamic",
            fetch: async (): Promise<CompletionChoice[]> => {
              const tomlDir = await findLocalConfigDir(cliName);
              const options = await buildLocationOptions(cliName, tomlDir);
              return options.map((o) => ({ label: o.label, value: o.resolvedDir }));
            },
          },
        },
      },
    },
    async run(args: ParsedArgs, runtime: Runtime): Promise<void> {
      const pluginName = await resolveArg(
        args.flags["name"] as string | undefined,
        "Plugin name",
        (v) => {
          if (!v.trim()) return "Name cannot be empty";
          if (!/^[a-z][a-z0-9-]*$/.test(v.trim()))
            return "Use lowercase letters, numbers, and hyphens";
          return undefined;
        },
        runtime,
      );
      const pluginDescription = await resolveArg(
        args.flags["description"] as string | undefined,
        "Description",
        (v) => (v.trim() ? undefined : "Cannot be empty"),
        runtime,
      );

      // location is required with dynamic completion — the framework prompts
      // interactively when not provided. When selected from the prompt the value
      // is the resolved absolute path; when passed on the command line it may be
      // relative and needs expanding.
      const locationStr = args.flags["location"] as string;
      const tomlDir = await findLocalConfigDir(cliName);
      const resolvedDir = expandHome(
        isAbsolute(locationStr) ? locationStr : join(process.cwd(), locationStr),
      );
      const isInsideProject = tomlDir !== null && !relative(tomlDir, resolvedDir).startsWith("..");
      const chosen: LocationOption = {
        label: locationStr,
        resolvedDir,
        tomlDir: isInsideProject ? tomlDir : null,
      };

      // Write files
      const pluginDir = join(chosen.resolvedDir, pluginName);
      await mkdir(pluginDir, { recursive: true });

      // For repo-local locations, ensure .{cliName}/ type helpers exist.
      // Auto-generate on first use; update manually with `plugin init`.
      let importPath: string | null = null;
      if (chosen.tomlDir) {
        const typesDir = join(chosen.tomlDir, `.${cliName}`);
        if (!(await Bun.file(join(typesDir, "index.ts")).exists())) {
          await generatePluginTypes(cliName, version, configSchema, chosen.tomlDir);
        }
        importPath = `${relative(pluginDir, typesDir)}/index.ts`;
      }

      await Promise.all([
        Bun.write(
          join(pluginDir, `${pluginName}.plugin.toml`),
          pluginTomlTemplate(pluginName, pluginDescription),
        ),
        Bun.write(
          join(pluginDir, `${pluginName}.ts`),
          pluginTsTemplate(pluginName, pluginDescription, importPath),
        ),
      ]);

      runtime.output.success(`Created plugin "${pluginName}"`);
      const displayDir =
        tomlDir && pluginDir.startsWith(tomlDir) ? `./${relative(tomlDir, pluginDir)}/` : pluginDir;
      runtime.print(`  Location: ${displayDir}`);
      if (chosen.tomlDir) {
        runtime.print(
          `  Types:    .${cliName}/  (commit this folder — run '${cliName} plugin init' to update)`,
        );
      }
      runtime.print("");
      runtime.print("No registration needed — auto-discovered the next time you run the CLI.");
    },
  };
}

// ---------------------------------------------------------------------------
// Location option helpers
// ---------------------------------------------------------------------------

interface LocationOption {
  /** Label shown in the select prompt. */
  label: string;
  /** Absolute path of the directory where the plugin folder will be created. */
  resolvedDir: string;
  /**
   * Directory containing cli.config.ts (project root). Non-null only for
   * repo-local locations — enables the typed import from cli.config.ts.
   */
  tomlDir: string | null;
}

async function buildLocationOptions(
  cliName: string,
  tomlDir: string | null,
): Promise<LocationOption[]> {
  const options: LocationOption[] = [];

  if (tomlDir) {
    // Always offer the default local dir
    options.push({
      label: "./commands/  (project-local)",
      resolvedDir: join(tomlDir, "commands"),
      tomlDir,
    });

    // Additional dirs from the local config file only
    const localDoc = Bun.TOML.parse(
      await Bun.file(join(tomlDir, `.${cliName}.toml`))
        .text()
        .catch(() => ""),
    ) as Record<string, unknown>;
    const frameworkSection = (localDoc[cliName] as Record<string, unknown>) ?? {};
    const configuredDirs = (frameworkSection["pluginDirs"] as string[] | undefined) ?? [];

    for (const dir of configuredDirs) {
      const expanded = expandHome(dir);
      const resolved = isAbsolute(expanded) ? expanded : join(tomlDir, expanded);
      const isInsideProject = !relative(tomlDir, resolved).startsWith("..");
      options.push({
        label: `${dir}  (from [${cliName}] config)`,
        resolvedDir: resolved,
        tomlDir: isInsideProject ? tomlDir : null,
      });
    }
  }

  // User-level dir always available
  options.push({
    label: `~/.config/${cliName}/plugins/  (user-level, untyped)`,
    resolvedDir: join(xdgConfigHome(), cliName, "plugins"),
    tomlDir: null,
  });

  return options;
}

// ---------------------------------------------------------------------------
// Plugin init subcommand + type generation
// ---------------------------------------------------------------------------

function initSubcommand(
  cliName: string,
  version: string,
  configSchema: ConfigSchema,
): SubcommandDef {
  return {
    name: "init",
    description: `Generate .${cliName}/ type helpers for plugins in this repository`,
    async run(_args: ParsedArgs, runtime: Runtime): Promise<void> {
      const tomlDir = await findLocalConfigDir(cliName);
      if (!tomlDir) {
        runtime.printError(
          `Error: no .${cliName}.toml found. Run this from a repository that uses ${cliName}.`,
        );
        runtime.exit(1);
        return;
      }
      await generatePluginTypes(cliName, version, configSchema, tomlDir);
      runtime.output.success(`Generated .${cliName}/`);
      runtime.print(`  .${cliName}/cape.d.ts  — Cape type declarations`);
      runtime.print(`  .${cliName}/index.ts   — Typed defineCommand / defineSubcommand`);
      runtime.print("");
      runtime.print(`Commit .${cliName}/ so plugin authors in this repo get fully typed access.`);
      runtime.print(`Re-run after upgrading ${cliName}: ${cliName} plugin init`);
    },
  };
}

async function generatePluginTypes(
  cliName: string,
  version: string,
  schema: ConfigSchema,
  tomlDir: string,
): Promise<void> {
  const outDir = join(tomlDir, `.${cliName}`);
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    Bun.write(
      join(outDir, "cape.d.ts"),
      CAPE_TYPES || "// Run `cape prebuild` then rebuild your CLI to populate.\n",
    ),
    Bun.write(join(outDir, "index.ts"), pluginIndexTemplate(cliName, version, schema)),
  ]);
}

function pluginIndexTemplate(cliName: string, version: string, schema: ConfigSchema): string {
  const interfaceBody = schemaToTypeInterface(schema, 1);
  const emptyNote =
    Object.keys(schema).length === 0
      ? `  // No global config defined — add fields to ${cliName}'s CliConfig.config schema.\n`
      : "";
  return [
    `// Auto-generated by ${cliName} v${version} — do not edit.`,
    `// Regenerate with: ${cliName} plugin init`,
    ``,
    `import type {`,
    `  CommandDef,`,
    `  SubcommandDef,`,
    `  ArgSchema,`,
    `  InferParsedArgs,`,
    `  ConfigField,`,
    `  ConfigSchema,`,
    `  Runtime,`,
    `  InferConfig,`,
    `} from "./cape";`,
    ``,
    `// ---------------------------------------------------------------------------`,
    `// Global config — shape of runtime.config in plugins for ${cliName}`,
    `// Regenerate when ${cliName}'s config schema changes: ${cliName} plugin init`,
    `// ---------------------------------------------------------------------------`,
    ``,
    `export interface GlobalConfig {`,
    emptyNote + interfaceBody,
    `}`,
    ``,
    `// ---------------------------------------------------------------------------`,
    `// Plugin runtime`,
    `// ---------------------------------------------------------------------------`,
    ``,
    `type PluginRuntime<CC extends ConfigSchema = Record<never, ConfigField>> =`,
    `  Omit<Runtime, "commandConfig" | "config"> & {`,
    `    commandConfig: InferConfig<CC>;`,
    `    config: GlobalConfig;`,
    `  };`,
    ``,
    `// CommandRuntime<CC> — alias for PluginRuntime, for naming symmetry with built-in commands.`,
    `// Use as the type for runtime parameters when passing to helper classes/functions.`,
    `export type CommandRuntime<CC extends ConfigSchema = Record<never, ConfigField>> = PluginRuntime<CC>;`,
    ``,
    `// ---------------------------------------------------------------------------`,
    `// Typed helpers`,
    `// ---------------------------------------------------------------------------`,
    ``,
    `export function defineCommand<`,
    `  S extends ArgSchema,`,
    `  CC extends ConfigSchema = Record<never, ConfigField>,`,
    `>(def: {`,
    `  name: string;`,
    `  aliases?: string[];`,
    `  description: string;`,
    `  schema?: S;`,
    `  config?: CC;`,
    `  subcommands?: SubcommandDef[];`,
    `  run?(args: InferParsedArgs<S>, runtime: PluginRuntime<CC>): Promise<void>;`,
    `}): CommandDef {`,
    `  return def as CommandDef;`,
    `}`,
    ``,
    `export function defineSubcommand<`,
    `  S extends ArgSchema,`,
    `  CC extends ConfigSchema = Record<never, ConfigField>,`,
    `>(def: {`,
    `  name: string;`,
    `  aliases?: string[];`,
    `  description: string;`,
    `  schema?: S;`,
    `  config?: CC;`,
    `  run(args: InferParsedArgs<S>, runtime: PluginRuntime<CC>): Promise<void>;`,
    `}): SubcommandDef {`,
    `  return def as SubcommandDef;`,
    `}`,
    ``,
    `export function defineCommandConfig<S extends ConfigSchema>(schema: S): S {`,
    `  return schema;`,
    `}`,
    ``,
  ].join("\n");
}

/**
 * Converts a ConfigSchema to a TypeScript interface body (indented lines).
 * Used to generate the GlobalConfig interface in .{cliName}/index.ts.
 */
function schemaToTypeInterface(schema: ConfigSchema, depth: number): string {
  const pad = "  ".repeat(depth);
  return Object.entries(schema)
    .map(([key, field]) => {
      const doc = field.description ? `${pad}/** ${field.description} */\n` : "";
      if (field.type === "object") {
        const inner = schemaToTypeInterface(field.fields, depth + 1);
        return `${doc}${pad}${key}: {\n${inner}\n${pad}};`;
      }
      if (field.type === "array") {
        return `${doc}${pad}${key}: ${arrayItemType(field.items)}[];`;
      }
      const base =
        field.type === "number" ? "number" : field.type === "boolean" ? "boolean" : "string";
      const opt = field.default === undefined ? " | undefined" : "";
      return `${doc}${pad}${key}: ${base}${opt};`;
    })
    .join("\n");
}

function arrayItemType(item: ConfigField): string {
  if (item.type === "object") {
    return `{ ${Object.entries(item.fields)
      .map(([k, f]) => `${k}: ${arrayItemType(f)}`)
      .join("; ")} }`;
  }
  if (item.type === "array") return `${arrayItemType(item.items)}[]`;
  return item.type === "number" ? "number" : item.type === "boolean" ? "boolean" : "string";
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function pluginTomlTemplate(name: string, description: string): string {
  return [
    `name = "${name}"`,
    `description = ${JSON.stringify(description)}`,
    `command = "./${name}.ts"`,
    `enabled = true`,
    `frameworkVersion = "${FRAMEWORK_VERSION}"`,
    "",
  ].join("\n");
}

function pluginTsTemplate(name: string, description: string, importPath: string | null): string {
  const importLine = importPath
    ? `import { defineCommand } from "${importPath}";`
    : // User-level plugins have no access to the CLI package, so we inline a
      // no-op defineCommand for IDE type support. runtime.config is untyped.
      `// defineCommand is a no-op identity helper — no package install needed.\n` +
      `// eslint-disable-next-line @typescript-eslint/no-explicit-any\n` +
      `const defineCommand = (def: any) => def;`;

  const untypedNote = importPath
    ? ""
    : "\n  // Note: runtime.config is untyped (Record<string, unknown>)\n";

  return [
    importLine,
    "",
    `export default defineCommand({`,
    `  name: "${name}",`,
    `  description: ${JSON.stringify(description)},`,
    `  schema: {`,
    `    flags: {`,
    `      // example: { type: "string", description: "An example flag" },`,
    `    },`,
    `  },`,
    `  async run(args, runtime) {`,
    untypedNote,
    `    runtime.print("Running ${name}...");`,
    `  },`,
    `});`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function pluginDirs(cliName: string, codePluginDirs: string[], tomlDirs: string[]): string[] {
  return [
    join(process.cwd(), "commands"),
    join(homedir(), ".config", cliName, "plugins"),
    ...codePluginDirs,
    ...tomlDirs,
  ];
}

async function resolveArg(
  value: string | undefined,
  message: string,
  validate: (v: string) => string | undefined,
  runtime: Runtime,
): Promise<string> {
  if (value !== undefined) {
    const err = validate(value);
    if (err) {
      runtime.printError(`${message}: ${err}`);
      runtime.exit(1);
    }
    return value.trim();
  }
  try {
    return (await text({ message, validate })).trim();
  } catch (err) {
    if (err instanceof NonTtyError) {
      runtime.printError(`Error: ${message} is required. Use a flag.`);
      runtime.exit(1);
    }
    throw err;
  }
}
