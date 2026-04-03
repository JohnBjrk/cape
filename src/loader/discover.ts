import { join, dirname } from "node:path";
import { readdir } from "node:fs/promises";
import type { DiscoveredPlugin, MinimalManifest } from "./types.ts";

/**
 * Recursively scans `dirs` for *.plugin.toml files and returns all valid,
 * enabled plugins. Directories that don't exist are silently skipped.
 * Malformed manifests are warned about and skipped.
 */
export async function discoverPlugins(dirs: string[]): Promise<DiscoveredPlugin[]> {
  const results: DiscoveredPlugin[] = [];
  const seen = new Set<string>(); // deduplicate by canonical command name

  for (const dir of dirs) {
    const manifestPaths = await findManifestFiles(dir);
    for (const manifestPath of manifestPaths) {
      const manifest = await parseManifest(manifestPath);
      if (!manifest) continue;
      if (!manifest.enabled) continue;
      if (seen.has(manifest.name)) continue; // first dir wins

      seen.add(manifest.name);
      results.push({
        manifest,
        pluginDir: dirname(manifestPath),
        manifestPath,
      });
    }
  }

  return results;
}

/** Recursively finds all *.plugin.toml files under a directory. */
async function findManifestFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // directory doesn't exist or isn't readable
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await findManifestFiles(fullPath));
    } else if (entry.name.endsWith(".plugin.toml")) {
      results.push(fullPath);
    }
  }

  return results;
}

/** Parses and validates a *.plugin.toml file. Returns undefined on failure. */
async function parseManifest(manifestPath: string): Promise<MinimalManifest | undefined> {
  let raw: unknown;
  try {
    const content = await Bun.file(manifestPath).text();
    raw = Bun.TOML.parse(content);
  } catch (err) {
    console.warn(`[cape] Failed to parse plugin manifest at ${manifestPath}: ${err}`);
    return undefined;
  }

  if (!isValidManifest(raw)) {
    console.warn(`[cape] Invalid plugin manifest at ${manifestPath}: missing required fields`);
    return undefined;
  }

  return raw;
}

function isValidManifest(raw: unknown): raw is MinimalManifest {
  if (typeof raw !== "object" || raw === null) return false;
  const m = raw as Record<string, unknown>;
  return (
    typeof m["name"] === "string" &&
    typeof m["description"] === "string" &&
    typeof m["command"] === "string" &&
    typeof m["enabled"] === "boolean" &&
    typeof m["frameworkVersion"] === "string"
  );
}
