import { defineCommand } from "../../src/cli.ts";
import { resolveName } from "./helpers.ts";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { mkdir, copyFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";

export const installBinaryCommand = defineCommand({
  name: "install",
  description: "Copy the compiled binary to ~/.<name>/bin",
  schema: {
    flags: {
      name:   { type: "string", alias: "n", description: "CLI name (must match cli.config.ts)" },
      binary: { type: "string", alias: "b", description: "Path to binary (default: dist/<name>)" },
    },
  },
  async run(args, runtime) {
    const cwd = process.cwd();
    const configPath = join(cwd, "cli.config.ts");

    if (!existsSync(configPath)) {
      runtime.printError("Error: no cli.config.ts found in the current directory.");
      runtime.exit(1);
    }

    const { name: cliName } = await resolveName(configPath, args.flags.name as string | undefined, runtime);
    const outfile  = await resolveOutfile(configPath, cliName);
    const binSrc   = args.flags.binary
      ? resolve(cwd, args.flags.binary as string)
      : join(cwd, "dist", outfile);

    if (!existsSync(binSrc)) {
      runtime.printError(`Error: binary not found at ${binSrc}`);
      runtime.printError(`Run \`cape build\` first to compile, then \`cape install\` to install.`);
      if (!args.flags.binary) {
        runtime.printError(`Or pass --binary <path> to point to a binary in a different location.`);
      }
      runtime.exit(1);
    }

    const binDir  = join(homedir(), `.${cliName}`, "bin");
    const destPath = join(binDir, cliName);

    await mkdir(binDir, { recursive: true });
    await copyFile(binSrc, destPath);
    await chmod(destPath, 0o755);

    runtime.output.success(`Installed: ${destPath}`);
    runtime.print("");
    runtime.print("Make sure the directory is in your PATH:");
    runtime.print(`  export PATH="$HOME/.${cliName}/bin:$PATH"`);
    runtime.print("");
  },
});

async function resolveOutfile(configPath: string, fallback: string): Promise<string> {
  try {
    const mod = await import(configPath) as { default?: { outfile?: string } };
    return mod.default?.outfile ?? fallback;
  } catch {
    return fallback;
  }
}
