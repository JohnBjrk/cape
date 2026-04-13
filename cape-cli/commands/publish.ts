import { defineCommand } from "../../src/cli.ts";
import { resolveName } from "./helpers.ts";
import { join } from "node:path";
import { readdir, writeFile, unlink, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import type { InstallConfig } from "../../src/cli.ts";

export const publishCommand = defineCommand({
  name: "publish",
  description: "Publish a GitHub release with the built binaries from dist/",
  schema: {
    flags: {
      draft: {
        type: "boolean",
        description: "Create as a draft release (publish manually on GitHub when ready)",
      },
      yes: {
        type: "boolean",
        alias: "y",
        description: "Skip confirmation prompt (for non-interactive / CI use)",
      },
    },
  },
  async run(args, runtime) {
    const cwd = process.cwd();
    const configPath = join(cwd, "cli.config.ts");

    if (!existsSync(configPath)) {
      runtime.printError("Error: no cli.config.ts found in the current directory.");
      runtime.exit(1);
    }

    const { name, config } = await resolveName(configPath, undefined, runtime);
    const version = config.version as string | undefined;
    const displayName = (config.displayName as string | undefined) ?? name;
    const install = config.install as InstallConfig | undefined;

    if (!version) {
      runtime.printError("Error: cli.config.ts must have a version field to publish.");
      runtime.exit(1);
    }

    const tag = `v${version}`;
    const distDir = join(cwd, "dist");

    // --- verify binary version matches config --------------------------------

    const binGz = findCurrentPlatformBinary(distDir, name);
    if (!binGz) {
      runtime.printError(
        "Error: no binary found in dist/. Run `cape build --all-platforms` first.",
      );
      runtime.exit(1);
      return;
    }

    const tmpBin = join(tmpdir(), `cape-verify-${Date.now()}`);
    try {
      const decompressed = Bun.gunzipSync(await Bun.file(binGz).bytes());
      await writeFile(tmpBin, decompressed);
      await chmod(tmpBin, 0o755);

      const versionCheck = await runtime.exec.run([tmpBin, "--version"], { noThrow: true });
      const binOutput = versionCheck.stdout.trim();
      const expected = `${name} ${version}`;
      if (!versionCheck.ok || binOutput !== expected) {
        runtime.printError("Error: binary version does not match cli.config.ts.");
        runtime.printError(`  Config: ${expected}`);
        runtime.printError(`  Binary: ${binOutput || "(could not read)"}`);
        runtime.printError("Run `cape build --all-platforms` to rebuild with the current version.");
        runtime.exit(1);
      }
    } finally {
      await unlink(tmpBin).catch(() => {});
    }

    // --- pre-flight checks ---------------------------------------------------

    const ghCheck = await runtime.exec.run(["gh", "--version"], { noThrow: true });
    if (!ghCheck.ok) {
      runtime.printError("Error: gh CLI not found. Install from https://cli.github.com/");
      runtime.exit(1);
    }

    const authCheck = await runtime.exec.run(["gh", "auth", "status"], { noThrow: true });
    if (!authCheck.ok) {
      runtime.printError("Error: not authenticated with GitHub. Run `gh auth login` first.");
      runtime.exit(1);
    }

    const existingTag = await runtime.exec.run(["git", "tag", "-l", tag]);
    if (existingTag.stdout.trim()) {
      runtime.printError(`Error: git tag ${tag} already exists.`);
      runtime.printError("Bump the version in cli.config.ts and rebuild before publishing again.");
      runtime.exit(1);
    }

    const entries = await readdir(distDir);
    const assets = entries
      .filter((e) => e.endsWith(".gz") || e === "install.sh")
      .map((e) => join(distDir, e));

    // --- confirm -------------------------------------------------------------

    const draft = args.flags.draft as boolean;
    const yes = args.flags.yes as boolean;

    runtime.print(`  Name:    ${displayName}`);
    runtime.print(`  Version: ${version}`);
    runtime.print(`  Tag:     ${tag}`);
    runtime.print(`  Assets:  ${assets.length} files from dist/`);
    if (draft) runtime.print(`  Mode:    draft`);
    runtime.print("");

    if (!yes) {
      let confirmed: boolean;
      try {
        confirmed = await runtime.prompt.confirm({
          message: draft
            ? `Create draft release ${tag} on GitHub?`
            : `Publish ${displayName} ${tag} to GitHub?`,
        });
      } catch (err) {
        if (err instanceof runtime.prompt.NonTtyError) {
          runtime.printError("Error: pass --yes to confirm publish in non-interactive mode.");
          runtime.exit(1);
        }
        throw err;
      }
      if (!confirmed) {
        runtime.print("Aborted.");
        runtime.exit(0);
      }
      runtime.print("");
    }

    // --- publish -------------------------------------------------------------

    const ghArgs = [
      "gh",
      "release",
      "create",
      tag,
      "--title",
      `${displayName} ${tag}`,
      "--generate-notes",
      ...(draft ? ["--draft"] : []),
      ...assets,
    ];

    const exitCode = await runtime.exec.interactive(ghArgs);

    if (exitCode !== 0) {
      runtime.printError(`\ngh release create failed (exit ${exitCode}).`);
      runtime.exit(exitCode);
    }

    runtime.print("");
    runtime.output.success(
      draft ? `Draft release ${tag} created` : `Published ${displayName} ${tag}`,
    );

    if (!draft && install?.type === "github") {
      runtime.print("");
      runtime.print("Install URL:");
      runtime.print(
        `  curl -fsSL https://github.com/${install.repo}/releases/latest/download/install.sh | sh`,
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the path to the current platform's binary in dist/, or undefined
 * if none is found. Prefers the platform-specific binary (from --all-platforms)
 * over the plain binary (from a single-platform build).
 */
/**
 * Returns the path to the current platform's binary in dist/.
 * Prefers the compressed .gz binary (from --all-platforms build),
 * falls back to the plain uncompressed binary (from a single-platform build).
 */
function findCurrentPlatformBinary(distDir: string, name: string): string | undefined {
  const os = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const gzBin = join(distDir, `${name}-${os}-${arch}.gz`);
  if (existsSync(gzBin)) return gzBin;
  const plainBin = join(distDir, name);
  if (existsSync(plainBin)) return plainBin;
  return undefined;
}
