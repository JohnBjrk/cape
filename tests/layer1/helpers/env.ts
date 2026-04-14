import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { golden as captureGolden, snapshot as captureSnapshot } from "./golden.ts";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  ok: boolean;
}

export interface ExecOpts {
  /** Working directory — relative to env.root or absolute */
  cwd?: string;
  /** Extra env vars merged on top of the isolated env */
  env?: Record<string, string>;
  /**
   * If set, capture the command + stdout to tests/golden/<name>.txt.
   * On normal runs the file is compared and mismatches fail the test.
   * Run with UPDATE_GOLDEN=1 to write or refresh golden files.
   */
  golden?: string;
  /**
   * Optional transform applied to stdout before writing/comparing the golden.
   * Useful for stripping volatile absolute paths from output — e.g.:
   *   normalize: (s) => s.replaceAll(env.home, "~")
   */
  normalize?: (s: string) => string;
}

export class TestEnv {
  private constructor(
    /** Temp directory for project files */
    public readonly root: string,
    /** Isolated HOME — keeps real user config from leaking into tests */
    public readonly home: string,
    /** Path to the cape binary */
    public readonly capeBin: string,
  ) {}

  static async create(): Promise<TestEnv> {
    const capeBin = findCapeBin();
    const root = await mkdtemp(join(tmpdir(), "cape-l1-"));
    const home = await mkdtemp(join(tmpdir(), "cape-l1-home-"));
    return new TestEnv(root, home, capeBin);
  }

  async exec(cmd: string[], opts: ExecOpts = {}): Promise<ExecResult> {
    // Replace "cape" with the resolved binary path
    const resolved = cmd[0] === "cape" ? [this.capeBin, ...cmd.slice(1)] : cmd;
    const cwd = opts.cwd
      ? isAbsolute(opts.cwd)
        ? opts.cwd
        : join(this.root, opts.cwd)
      : this.root;

    const proc = Bun.spawnSync(resolved, {
      cwd,
      env: {
        ...process.env,
        HOME: this.home,
        PATH: buildPath(this.home),
        ...opts.env,
      },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe", // non-TTY — prevents prompts from blocking
    });

    const stdout = new TextDecoder().decode(proc.stdout);
    const stderr = new TextDecoder().decode(proc.stderr);
    const exitCode = proc.exitCode ?? 1;
    const result = { stdout, stderr, exitCode, ok: exitCode === 0 };

    if (opts.golden) {
      await captureGolden(opts.golden, cmd, stdout, { normalize: opts.normalize });
    }

    return result;
  }

  async exists(relativePath: string): Promise<boolean> {
    return Bun.file(join(this.root, relativePath)).exists();
  }

  async read(relativePath: string): Promise<string> {
    return Bun.file(join(this.root, relativePath)).text();
  }

  async write(relativePath: string, content: string): Promise<void> {
    await Bun.write(join(this.root, relativePath), content);
  }

  /**
   * Capture or verify a golden snapshot for a file in the test env.
   * `goldenName` should include the extension (e.g. "quickstart/greet.ts").
   */
  async snapshot(relativePath: string, goldenName: string): Promise<void> {
    const content = await this.read(relativePath);
    await captureSnapshot(goldenName, content);
  }

  async cleanup(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
    await rm(this.home, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Locate the cape binary. Checks:
 *   1. The repo's dist/cape (freshly built)
 *   2. ~/.cape/bin/cape (installed)
 * Throws with a clear message if neither exists.
 */
function findCapeBin(): string {
  const repoRoot = join(import.meta.dir, "../../..");
  const distBin = join(repoRoot, "dist", "cape");
  if (require("node:fs").existsSync(distBin)) return distBin;

  const installedBin = join(process.env.HOME ?? "", ".cape", "bin", "cape");
  if (require("node:fs").existsSync(installedBin)) return installedBin;

  throw new Error(
    "cape binary not found. Run `bun run cape:bootstrap:build` or `bun run cape:install` first.",
  );
}

/**
 * Build a PATH that includes the installed binaries dir (so cape-built CLIs
 * can be found after `cape install`) but keeps the system PATH for tools
 * like bun.
 */
function buildPath(home: string): string {
  const binDir = join(home, ".my-tool", "bin"); // cape install puts binaries here
  return `${binDir}:${process.env.PATH ?? ""}`;
}
