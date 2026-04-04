import { defineCommand } from "../../src/cli.ts";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, chmod } from "node:fs/promises";
import { generateInstallScript } from "../../src/config/install.ts";
import { CAPE_BUNDLE } from "../src/embedded.ts";
import { resolveName, refreshCapeModule } from "./helpers.ts";

interface Platform { os: "darwin" | "linux"; arch: "arm64" | "x64" }

const ALL_PLATFORMS: Platform[] = [
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "linux",  arch: "arm64" },
  { os: "linux",  arch: "x64" },
];

export const buildCommand = defineCommand({
  name: "build",
  description: "Compile the CLI to a standalone binary",
  schema: {
    flags: {
      "all-platforms": {
        type: "boolean",
        description: "Build for all platforms: darwin-arm64, darwin-x64, linux-arm64, linux-x64",
      },
      outdir: {
        type: "string",
        description: "Output directory (default: dist/)",
        default: "dist",
      },
    },
  },
  async run(args, runtime) {
    const cwd = process.cwd();
    const configPath = join(cwd, "cli.config.ts");

    if (!existsSync(configPath)) {
      runtime.printError("Error: no cli.config.ts found in the current directory.");
      runtime.printError("Run `cape init <name>` to create a new Cape project.");
      runtime.exit(1);
    }

    // Load config (no --name flag on build; just load and proceed)
    const { name, config } = await resolveName(configPath, undefined, runtime);
    const version = config.version as string | undefined;
    const entry   = resolve(cwd, (config.entry as string | undefined) ?? "main.ts");
    const outdir  = resolve(cwd, args.flags.outdir as string);
    const allPlatforms = args.flags["all-platforms"] as boolean;

    if (!existsSync(entry)) {
      runtime.printError(`Error: entry file not found: ${entry}`);
      runtime.exit(1);
    }

    await mkdir(outdir, { recursive: true });

    // Ensure node_modules/cape/ is current so the bundle gets compiled in
    if (CAPE_BUNDLE) {
      await refreshCapeModule(cwd);
    }

    const displayName = (config.displayName as string | undefined) ?? name;
    runtime.print(`Building ${displayName}${version ? ` v${version}` : ""}...`);

    if (allPlatforms) {
      await buildAllPlatforms(name, entry, outdir, cwd, runtime);
    } else {
      await buildCurrentPlatform(name, entry, outdir, cwd, runtime);
    }

    // Generate install.sh if an install source is configured
    if ((config.install || config.repository) && version) {
      try {
        const installPath = join(cwd, "install.sh");
        await Bun.write(installPath, generateInstallScript({ ...(config as never), version }));
        await chmod(installPath, 0o755);
        runtime.output.success(`install.sh: ${installPath}`);
        runtime.print(`  Distribute: curl -fsSL <url>/install.sh | sh`);
      } catch (err) {
        runtime.printError(`Warning: could not generate install.sh: ${err instanceof Error ? err.message : err}`);
      }
    }
  },
});

async function buildCurrentPlatform(
  name: string,
  entry: string,
  outdir: string,
  cwd: string,
  runtime: { printError: (s: string) => void; output: { success: (s: string) => void } },
): Promise<void> {
  const outfile = join(outdir, name);
  const proc = Bun.spawnSync(
    ["bun", "build", "--compile", `--outfile=${outfile}`, entry],
    { cwd, stdout: "inherit", stderr: "inherit" },
  );
  if (proc.exitCode !== 0) {
    runtime.printError("Build failed.");
    process.exit(proc.exitCode ?? 1);
  }
  runtime.output.success(`Built: ${outfile}`);
}

async function buildAllPlatforms(
  name: string,
  entry: string,
  outdir: string,
  cwd: string,
  runtime: { printError: (s: string) => void; output: { success: (s: string) => void }; print: (s: string) => void },
): Promise<void> {
  for (const { os, arch } of ALL_PLATFORMS) {
    const outfile = join(outdir, `${name}-${os}-${arch}`);
    runtime.print(`  ${os}/${arch}...`);

    const proc = Bun.spawnSync(
      [
        "bun", "build", "--compile",
        `--target=bun-${os}-${arch}`,
        `--outfile=${outfile}`,
        entry,
      ],
      { cwd, stdout: "pipe", stderr: "inherit" },
    );

    if (proc.exitCode !== 0) {
      runtime.printError(`  Failed: ${os}/${arch}`);
      process.exit(proc.exitCode ?? 1);
    }
    runtime.output.success(`  Built: ${outfile}`);
  }
}

