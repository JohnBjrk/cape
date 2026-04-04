/**
 * Minimal TOML parser — zero dependencies.
 *
 * Handles the subset of TOML used by Cape:
 *   - Comments  (# ...)
 *   - Strings   key = "value"   (double-quoted, basic escapes)
 *               key = 'value'   (single-quoted, no escapes)
 *   - Integers  key = 42
 *   - Floats    key = 3.14
 *   - Booleans  key = true / false
 *   - Sections  [section-name]
 *
 * Returns a Record<section, Record<key, value>> where top-level keys
 * are stored under the "" (empty string) key.
 */

export type TomlValue = string | number | boolean;
export type TomlSection = Record<string, TomlValue>;
export type TomlDocument = Record<string, TomlSection>;

export function parseToml(text: string): TomlDocument {
  const doc: TomlDocument = { "": {} };
  let section = "";

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith("#")) continue;

    // Section header: [name]
    if (line.startsWith("[") && !line.startsWith("[[")) {
      const close = line.indexOf("]");
      if (close === -1) continue;
      section = line.slice(1, close).trim();
      if (!doc[section]) doc[section] = {};
      continue;
    }

    // Key = value
    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!key) continue;

    const rawVal = line.slice(eq + 1).trim();

    // Strip inline comment after value (for unquoted values)
    let value: TomlValue;

    if (rawVal.startsWith('"')) {
      // Double-quoted string — parse with escape sequences
      const end = findClosingQuote(rawVal, 1, '"');
      const inner = end === -1 ? rawVal.slice(1) : rawVal.slice(1, end);
      value = unescapeBasicString(inner);
    } else if (rawVal.startsWith("'")) {
      // Single-quoted literal string — no escapes
      const end = findClosingQuote(rawVal, 1, "'");
      value = end === -1 ? rawVal.slice(1) : rawVal.slice(1, end);
    } else if (rawVal === "true") {
      value = true;
    } else if (rawVal === "false") {
      value = false;
    } else {
      // Number or bare string — strip inline comment
      const commentIdx = rawVal.indexOf(" #");
      const bare = commentIdx === -1 ? rawVal : rawVal.slice(0, commentIdx).trimEnd();
      const num = Number(bare);
      value = Number.isFinite(num) && bare !== "" ? num : bare;
    }

    if (!doc[section]) doc[section] = {};
    doc[section]![key] = value;
  }

  return doc;
}

/** Serialises a TomlDocument back to TOML text. */
export function serializeToml(doc: TomlDocument): string {
  const lines: string[] = [];

  // Top-level keys first
  const topLevel = doc[""] ?? {};
  for (const [k, v] of Object.entries(topLevel)) {
    lines.push(`${k} = ${tomlValue(v)}`);
  }

  for (const [section, entries] of Object.entries(doc)) {
    if (section === "") continue;
    if (lines.length > 0) lines.push("");
    lines.push(`[${section}]`);
    for (const [k, v] of Object.entries(entries)) {
      lines.push(`${k} = ${tomlValue(v)}`);
    }
  }

  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tomlValue(v: TomlValue): string {
  if (typeof v === "string") return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`;
  return String(v);
}

function findClosingQuote(s: string, start: number, quote: string): number {
  for (let i = start; i < s.length; i++) {
    if (s[i] === "\\" && quote === '"') { i++; continue; }
    if (s[i] === quote) return i;
  }
  return -1;
}

function unescapeBasicString(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}
