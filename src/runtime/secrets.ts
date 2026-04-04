import { join } from "node:path";
import { parseToml, serializeToml } from "./toml.ts";
import { xdgConfigHome } from "./fs.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SecretsInterface {
  /** Get a secret value scoped to the current command. */
  get(key: string): Promise<string | undefined>;
  /** Set a secret value scoped to the current command. */
  set(key: string, value: string): Promise<void>;
  /** Delete a secret value scoped to the current command. */
  delete(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Real implementation — backed by credentials.toml (mode 0600)
// ---------------------------------------------------------------------------

export function createSecrets(cliName: string, commandName: string): SecretsInterface {
  const filePath = join(xdgConfigHome(), cliName, "credentials.toml");

  async function loadDoc() {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return {};
    try {
      return parseToml(await file.text());
    } catch {
      return {};
    }
  }

  async function saveDoc(doc: ReturnType<typeof parseToml>) {
    const { mkdir, chmod } = await import("node:fs/promises");
    const dir = filePath.slice(0, filePath.lastIndexOf("/"));
    await mkdir(dir, { recursive: true });
    await Bun.write(filePath, serializeToml(doc));
    await chmod(filePath, 0o600);
  }

  return {
    async get(key) {
      const doc = await loadDoc();
      const section = doc[commandName] ?? doc[""] ?? {};
      const value = section[key];
      return typeof value === "string" ? value : value !== undefined ? String(value) : undefined;
    },

    async set(key, value) {
      const doc = await loadDoc();
      if (!doc[commandName]) doc[commandName] = {};
      doc[commandName]![key] = value;
      await saveDoc(doc);
    },

    async delete(key) {
      const doc = await loadDoc();
      if (doc[commandName]) {
        delete doc[commandName]![key];
        await saveDoc(doc);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------

/** Mock SecretsInterface backed by an in-memory Map. */
export function createMockSecrets(initial: Record<string, string> = {}): SecretsInterface & {
  store: Map<string, string>;
} {
  const store = new Map<string, string>(Object.entries(initial));

  return {
    store,
    async get(key)        { return store.get(key); },
    async set(key, value) { store.set(key, value); },
    async delete(key)     { store.delete(key); },
  };
}
