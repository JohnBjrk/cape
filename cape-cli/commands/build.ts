import { defineCommand } from "../../src/cli.ts";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, chmod, unlink, rename } from "node:fs/promises";
import { generateInstallScript } from "../../src/config/install.ts";
import { CAPE_BUNDLE } from "../src/embedded.ts";
import { resolveName, refreshCapeModule } from "./helpers.ts";

interface Platform {
  os: "darwin" | "linux";
  arch: "arm64" | "x64";
}

const ALL_PLATFORMS: Platform[] = [
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "x64" },
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
    const entry = resolve(cwd, (config.entry as string | undefined) ?? "main.ts");
    const outdir = resolve(cwd, args.flags.outdir as string);
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
    if (config.install && version) {
      try {
        const installPath = join(outdir, "install.sh");
        await Bun.write(
          installPath,
          generateInstallScript({ ...config, version } as Parameters<
            typeof generateInstallScript
          >[0]),
        );
        await chmod(installPath, 0o755);
        runtime.output.success(`install.sh: ${installPath}`);
        runtime.print(`  Distribute: curl -fsSL <url>/install.sh | sh`);
      } catch (err) {
        runtime.printError(
          `Warning: could not generate install.sh: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  },
});

async function buildCurrentPlatform(
  name: string,
  entry: string,
  outdir: string,
  _cwd: string,
  runtime: { printError: (s: string) => void; output: { success: (s: string) => void } },
): Promise<void> {
  const outfile = join(outdir, name);

  // Use Bun.build() directly — no subprocess, no dependency on bun in PATH.
  const result = await Bun.build({
    entrypoints: [entry],
    outdir,
    compile: true,
    target: "bun",
  });

  if (!result.success) {
    for (const log of result.logs) runtime.printError(log.message);
    runtime.printError("Build failed.");
    process.exit(1);
  }

  // Bun names the output after the entry filename — rename to the CLI name.
  const builtPath = result.outputs[0]?.path;
  if (builtPath && builtPath !== outfile) {
    await rename(builtPath, outfile);
  }

  runtime.output.success(`Built: ${outfile}`);
}

async function buildAllPlatforms(
  name: string,
  entry: string,
  outdir: string,
  _cwd: string,
  runtime: {
    printError: (s: string) => void;
    output: { success: (s: string) => void };
    print: (s: string) => void;
  },
): Promise<void> {
  for (const { os, arch } of ALL_PLATFORMS) {
    const outfile = join(outdir, `${name}-${os}-${arch}`);
    runtime.print(`  ${os}/${arch}...`);

    // "bun-<os>-<arch>" targets are not in the TypeScript types but work at
    // runtime for cross-compilation. For the native platform, Bun.build() can
    // fail with an ELF section error on linux/x64 — fall back to spawning the
    // bun CLI in that case (bun is expected to be available for --all-platforms).
    const currentOs = process.platform === "darwin" ? "darwin" : "linux";
    const currentArch = process.arch === "arm64" ? "arm64" : "x64";
    const isNative = os === currentOs && arch === currentArch;

    const builtPath = isNative
      ? await buildNativePlatform(entry, outdir, outfile, runtime)
      : await buildCrossPlatform(entry, outdir, outfile, os, arch, runtime);

    // Compress and replace the plain binary with a .gz
    const compressed = Bun.gzipSync(await Bun.file(outfile).bytes(), { level: 9 });
    await Bun.write(`${outfile}.gz`, compressed);
    await unlink(outfile);

    runtime.output.success(`  Built: ${outfile}.gz`);
  }
}

type BuildRuntime = { printError: (s: string) => void };
type BunBuildResult = { success: boolean; logs: { message: string }[]; outputs: { path: string }[] };

/** Build for the current platform using Bun.build(), falling back to spawning
 *  the bun CLI if Bun.build() fails (known ELF issue on linux/x64). */
async function buildNativePlatform(
  entry: string,
  outdir: string,
  outfile: string,
  runtime: BuildRuntime,
): Promise<string> {
  const result = await (Bun.build as (opts: unknown) => Promise<BunBuildResult>)({
    entrypoints: [entry],
    outdir,
    compile: true,
    target: "bun",
  });

  if (result.success) {
    const builtPath = result.outputs[0]?.path ?? outfile;
    if (builtPath !== outfile) await rename(builtPath, outfile);
    return outfile;
  }

  // Bun.build() can fail with an ELF section error on linux/x64 when called
  // from within a compiled binary. Fall back to spawning the bun CLI.
  const proc = Bun.spawnSync(["bun", "build", "--compile", `--outfile=${outfile}`, entry], {
    stdout: "pipe",
    stderr: "pipe",
  });

  if (proc.exitCode !== 0) {
    for (const log of result.logs) runtime.printError(log.message);
    const stderr = new TextDecoder().decode(proc.stderr).trim();
    if (stderr) runtime.printError(stderr);
    runtime.printError(
      `  Native build failed. Ensure bun is installed for --all-platforms builds on this platform.`,
    );
    process.exit(1);
  }

  return outfile;
}

/** Build for a non-native platform using Bun.build() cross-compilation. */
async function buildCrossPlatform(
  entry: string,
  outdir: string,
  outfile: string,
  os: string,
  arch: string,
  runtime: BuildRuntime,
): Promise<string> {
  const result = await (Bun.build as (opts: unknown) => Promise<BunBuildResult>)({
    entrypoints: [entry],
    outdir,
    compile: true,
    target: `bun-${os}-${arch}`,
  });

  if (!result.success) {
    for (const log of result.logs) runtime.printError(log.message);
    runtime.printError(`  Failed: ${os}/${arch}`);
    process.exit(1);
  }

  const builtPath = result.outputs[0]?.path ?? outfile;
  if (builtPath !== outfile) await rename(builtPath, outfile);
  return outfile;
}
