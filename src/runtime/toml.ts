/**
 * TOML utilities backed by Bun's native parser.
 *
 * `parseToml` delegates to `Bun.TOML.parse`, which handles the full TOML spec:
 *   - Scalars, booleans, integers, floats
 *   - Inline arrays:         tags = ["a", "b"]
 *   - Inline tables:         server = { host = "localhost", port = 8080 }
 *   - Section headers:       [section-name]
 *   - Arrays of tables:      [[array-of-tables]]
 *
 * The returned `TomlDocument` is a flat Record where top-level scalars/arrays
 * appear directly and `[section]` headers produce nested objects.
 */

/** A parsed TOML document. Top-level keys are scalars, arrays, or section objects. */
export type TomlDocument = Record<string, unknown>;

export function parseToml(text: string): TomlDocument {
  if (!text.trim()) return {};
  return Bun.TOML.parse(text) as TomlDocument;
}

/**
 * Serialises a TomlDocument back to TOML text.
 * Scalars and arrays are written as top-level entries; plain objects become
 * `[section]` headers. Intended for credentials / secrets files.
 */
export function serializeToml(doc: TomlDocument): string {
  const lines: string[] = [];
  const sections: [string, Record<string, unknown>][] = [];

  for (const [key, value] of Object.entries(doc)) {
    if (isPlainObject(value)) {
      sections.push([key, value]);
    } else {
      lines.push(`${key} = ${tomlScalar(value)}`);
    }
  }

  for (const [section, entries] of sections) {
    if (lines.length > 0 || sections.indexOf([section, entries]) > 0) lines.push("");
    lines.push(`[${section}]`);
    for (const [k, v] of Object.entries(entries)) {
      lines.push(`${k} = ${tomlScalar(v)}`);
    }
  }

  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function tomlScalar(v: unknown): string {
  if (typeof v === "string") {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`;
  }
  return String(v);
}
