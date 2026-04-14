/**
 * Docs preprocessor: expand <!-- golden: name [lines:X-Y] --> markers.
 *
 * Each marker is replaced (idempotently) with a fenced code block whose
 * content comes from the matching file in tests/golden/.
 *
 * Marker syntax (HTML comment, on its own line):
 *   <!-- golden: quickstart/greet.ts -->
 *   <!-- golden: quickstart/init lines:3-10 -->
 *
 * The marker is preserved as the first line of the replacement block so
 * re-running the script is idempotent.
 *
 * Usage:
 *   bun scripts/expand-golden.ts              # expand all docs/**\/*.md in-place
 *   bun scripts/expand-golden.ts --check      # exit 1 if any file would change
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const GOLDEN_DIR = join(REPO_ROOT, "tests", "golden");
const DOCS_DIRS = ["docs", "README.md"];

const checkMode = process.argv.includes("--check");
let drift = false;

// ---------------------------------------------------------------------------

async function collectMarkdownFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const entry of DOCS_DIRS) {
    const abs = join(REPO_ROOT, entry);
    if (extname(abs) === ".md") {
      files.push(abs);
    } else {
      try {
        for await (const f of walk(abs)) files.push(f);
      } catch {
        // directory doesn't exist — skip
      }
    }
  }
  return files;
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (e.name.endsWith(".md")) {
      yield full;
    }
  }
}

// ---------------------------------------------------------------------------

const MARKER_RE = /^([ \t]*)<!-- golden: ([\w/.\-]+)(?:\s+lines:(\d+)-(\d+))? -->$/;

async function loadGolden(name: string, from?: number, to?: number): Promise<string> {
  const file = join(GOLDEN_DIR, name);
  const raw = await readFile(file, "utf8").catch(() => {
    throw new Error(`Golden file not found: tests/golden/${name}`);
  });
  const lines = raw.split("\n");
  const slice = from !== undefined && to !== undefined ? lines.slice(from - 1, to) : lines;
  // Remove trailing newline added by golden writer
  return slice.join("\n").replace(/\n$/, "");
}

function inferLang(name: string): string {
  const ext = extname(name).slice(1);
  // .txt golden files are command transcripts — render as shell sessions
  if (ext === "txt" || ext === "") return "sh";
  return ext;
}

async function expandFile(path: string): Promise<void> {
  const original = await readFile(path, "utf8");
  const lines = original.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const m = MARKER_RE.exec(line);
    if (!m) {
      out.push(line);
      i++;
      continue;
    }

    const indent = m[1]!;
    const name = m[2]!;
    const from = m[3] ? parseInt(m[3], 10) : undefined;
    const to = m[4] ? parseInt(m[4], 10) : undefined;

    // Skip any immediately-following fenced block (idempotency: strip old expansion)
    let j = i + 1;
    if (j < lines.length && (lines[j] ?? "").trimStart().startsWith("```")) {
      j++; // skip opening fence line
      while (j < lines.length && !(lines[j] ?? "").trimStart().startsWith("```")) j++;
      j++; // skip closing fence line
    }

    let content: string;
    try {
      content = await loadGolden(name, from, to);
    } catch (e) {
      console.error(`  [warn] ${e instanceof Error ? e.message : e}`);
      out.push(line);
      i = j; // still skip the stale block if present
      continue;
    }

    const lang = inferLang(name);
    out.push(line); // preserve marker
    out.push(`${indent}\`\`\`${lang}`);
    out.push(content);
    out.push(`${indent}\`\`\``);
    i = j;
  }

  const expanded = out.join("\n");

  if (expanded === original) return;

  if (checkMode) {
    console.error(`[drift] ${path.replace(REPO_ROOT + "/", "")}`);
    drift = true;
    return;
  }

  await writeFile(path, expanded, "utf8");
  console.log(`[updated] ${path.replace(REPO_ROOT + "/", "")}`);
}

// ---------------------------------------------------------------------------

const files = await collectMarkdownFiles();
for (const f of files) {
  await expandFile(f);
}

if (checkMode && drift) {
  console.error("\nDocs are out of date. Run `bun run docs:expand` to refresh.");
  process.exit(1);
}
