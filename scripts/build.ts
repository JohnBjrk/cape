#!/usr/bin/env bun
/**
 * Cape build script — compiles a cli.config.ts project into a standalone binary.
 *
 * Usage:
 *   bun scripts/build.ts [path/to/cli.config.ts]
 *
 * Defaults to ./cli.config.ts in the current working directory.
 * The cli.config.ts must have a default export created with defineConfig().
 */

import { resolve, dirname, join } from "node:path";
import type { CliConfigDef } from "../src/config/index.ts";
import { generateInstallScript } from "../src/config/install.ts";

const configPath = resolve(process.argv[2] ?? "cli.config.ts");
const configDir = dirname(configPath);

let config: CliConfigDef;
try {
  const mod = (await import(configPath)) as { default?: CliConfigDef };
  if (!mod.default) {
    console.error(`Error: ${configPath} has no default export.`);
    console.error("Make sure cli.config.ts exports: export default defineConfig({ ... })");
    process.exit(1);
  }
  config = mod.default;
} catch (err) {
  console.error(`Error: could not load ${configPath}`);
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const entry = resolve(configDir, config.entry ?? "main.ts");
const outfile = resolve(configDir, config.outfile ?? config.name);
const displayName = config.displayName ?? config.name;

console.log(`Building ${displayName} v${config.version}...`);
console.log(`  entry:  ${entry}`);
console.log(`  output: ${outfile}`);

const proc = Bun.spawnSync(["bun", "build", "--compile", `--outfile=${outfile}`, entry], {
  cwd: configDir,
  stdout: "inherit",
  stderr: "inherit",
});

if (proc.exitCode !== 0) {
  console.error("\nBuild failed.");
  process.exit(proc.exitCode ?? 1);
}

console.log(`\n✓  Built: ${outfile}`);
console.log(`   Run:   ./${config.outfile ?? config.name} --help`);

// --- install.sh -----------------------------------------------------------
if (config.install || config.repository) {
  const installPath = join(configDir, "install.sh");
  await Bun.write(installPath, generateInstallScript({ ...config, version: config.version }));
  // Make executable
  const { chmod } = await import("node:fs/promises");
  await chmod(installPath, 0o755);
  console.log(`\n✓  install.sh: ${installPath}`);
  console.log(`   Distribute: curl -fsSL <url>/install.sh | sh`);
}
