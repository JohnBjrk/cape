import { join, dirname } from "node:path";
import { mkdir } from "node:fs/promises";

const GOLDEN_DIR = join(import.meta.dir, "../../golden");

/**
 * Capture or verify a golden file for a command + its output.
 *
 * Normal runs: compare output against the stored golden file and throw on mismatch.
 * UPDATE_GOLDEN=1: write (or overwrite) the golden file with the current output.
 *
 * Golden files live at tests/golden/<name>.txt and should be committed to the repo.
 */
export async function golden(name: string, cmd: string[], output: string): Promise<void> {
  const file = join(GOLDEN_DIR, `${name}.txt`);
  const content = `$ ${shellJoin(normalizeCmd(cmd))}\n${stripAnsi(output).trimEnd()}\n`;

  if (process.env.UPDATE_GOLDEN === "1") {
    await mkdir(dirname(file), { recursive: true });
    await Bun.write(file, content);
    return;
  }

  const existing = await Bun.file(file).text().catch(() => null);

  if (existing === null) {
    throw new Error(
      `Golden file missing: tests/golden/${name}.txt\n` +
        `Run UPDATE_GOLDEN=1 bun test to create it.`,
    );
  }

  if (existing !== content) {
    const diff = unified(existing, content);
    throw new Error(`Golden mismatch: ${name}\n\n${diff}\nRun UPDATE_GOLDEN=1 bun test to update.`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Replace an absolute cape binary path with "cape" for readable golden files. */
function normalizeCmd(cmd: string[]): string[] {
  if (cmd[0] && cmd[0] !== "cape" && /\/cape$/.test(cmd[0])) {
    return ["cape", ...cmd.slice(1)];
  }
  return cmd;
}

/** Join command args, quoting any that contain spaces. */
function shellJoin(cmd: string[]): string {
  return cmd.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ");
}

/** Strip ANSI escape codes so golden files are plain text. */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Produce a simple +/- diff between two strings for readable error output. */
function unified(expected: string, actual: string): string {
  const a = expected.split("\n");
  const b = actual.split("\n");
  const lines: string[] = ["--- expected", "+++ actual"];
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] === b[i]) {
      lines.push(`  ${a[i] ?? ""}`);
    } else {
      if (i < a.length) lines.push(`- ${a[i]}`);
      if (i < b.length) lines.push(`+ ${b[i]}`);
    }
  }
  return lines.join("\n");
}
