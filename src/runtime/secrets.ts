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
  /**
   * Access secrets stored by a specific command section.
   * Use this to read credentials written by another command — for example,
   * reading an auth token stored by the `login` command:
   *
   * @example
   * const token = await runtime.secrets.from("login").get("token");
   */
  from(section: string): Omit<SecretsInterface, "from">;
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

  function scopedTo(section: string): SecretsInterface {
    return {
      async get(key) {
        const doc = await loadDoc();
        const sec = (doc[section] as Record<string, unknown> | undefined) ?? {};
        const value = sec[key];
        return typeof value === "string" ? value : value !== undefined ? String(value) : undefined;
      },
      async set(key, value) {
        const doc = await loadDoc();
        if (!doc[section]) doc[section] = {};
        (doc[section] as Record<string, unknown>)[key] = value;
        await saveDoc(doc);
      },
      async delete(key) {
        const doc = await loadDoc();
        const sec = doc[section] as Record<string, unknown> | undefined;
        if (sec) {
          delete sec[key];
          await saveDoc(doc);
        }
      },
      from(other) {
        return scopedTo(other);
      },
    };
  }

  return scopedTo(commandName);
}

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------

/**
 * Mock SecretsInterface backed by an in-memory Map.
 * Default `get/set/delete` use flat keys. Cross-section access via `from(section)`
 * uses `"section/key"` prefixed keys so tests can pre-populate them:
 *
 * @example
 * const runtime = new MockRuntime({
 *   secrets: { "login/token": "abc123" },
 * });
 * // runtime.secrets.from("login").get("token") → "abc123"
 */
export function createMockSecrets(initial: Record<string, string> = {}): SecretsInterface & {
  store: Map<string, string>;
} {
  const store = new Map<string, string>(Object.entries(initial));

  function scopedTo(prefix: string): SecretsInterface {
    const k = (key: string) => (prefix ? `${prefix}/${key}` : key);
    return {
      async get(key) {
        return store.get(k(key));
      },
      async set(key, value) {
        store.set(k(key), value);
      },
      async delete(key) {
        store.delete(k(key));
      },
      from(section) {
        return scopedTo(section);
      },
    };
  }

  const base = scopedTo("");
  return { ...base, store };
}
