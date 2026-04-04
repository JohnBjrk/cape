import { join } from "node:path";
import { homedir } from "node:os";
import { readdir } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FsInterface {
  /** Read a file as a UTF-8 string. */
  read(path: string): Promise<string>;
  /** Read a file as raw bytes. */
  readBytes(path: string): Promise<Uint8Array>;
  /**
   * Write a file.  Parent directory is created automatically.
   * @param mode Optional Unix permissions, e.g. 0o600. Defaults to 0o644.
   */
  write(path: string, content: string | Uint8Array, mode?: number): Promise<void>;
  /** Returns true if the path exists (file or directory). */
  exists(path: string): Promise<boolean>;
  /** List entries in a directory. Returns basenames only. */
  list(path: string): Promise<string[]>;

  /** Path under `$XDG_CONFIG_HOME/<cliName>` (or `~/.config/<cliName>`). */
  configPath(...segments: string[]): string;
  /** Path under `$XDG_DATA_HOME/<cliName>` (or `~/.local/share/<cliName>`). */
  dataPath(...segments: string[]): string;
  /** Path under `$XDG_CACHE_HOME/<cliName>` (or `~/.cache/<cliName>`). */
  cachePath(...segments: string[]): string;
}

// ---------------------------------------------------------------------------
// Real implementation
// ---------------------------------------------------------------------------

export function createFs(cliName: string): FsInterface {
  const configBase = join(xdgConfigHome(), cliName);
  const dataBase   = join(xdgDataHome(),   cliName);
  const cacheBase  = join(xdgCacheHome(),  cliName);

  async function read(path: string): Promise<string> {
    return Bun.file(path).text();
  }

  async function readBytes(path: string): Promise<Uint8Array> {
    return new Uint8Array(await Bun.file(path).arrayBuffer());
  }

  async function write(path: string, content: string | Uint8Array, mode = 0o644): Promise<void> {
    // Ensure parent directory exists
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (dir) {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(dir, { recursive: true });
    }
    await Bun.write(path, content);
    // Set permissions after writing
    const { chmod } = await import("node:fs/promises");
    await chmod(path, mode);
  }

  async function exists(path: string): Promise<boolean> {
    return Bun.file(path).exists();
  }

  async function list(path: string): Promise<string[]> {
    try {
      return await readdir(path);
    } catch {
      return [];
    }
  }

  return {
    read,
    readBytes,
    write,
    exists,
    list,
    configPath(...segments) { return join(configBase, ...segments); },
    dataPath(...segments)   { return join(dataBase, ...segments); },
    cachePath(...segments)  { return join(cacheBase, ...segments); },
  };
}

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------

export type MockFsEntry = string | Uint8Array;

/** Mock FsInterface backed by an in-memory Map. */
export function createMockFs(cliName = "test"): FsInterface & {
  files: Map<string, MockFsEntry>;
} {
  const files = new Map<string, MockFsEntry>();

  function read(path: string): Promise<string> {
    const entry = files.get(path);
    if (entry === undefined) return Promise.reject(new Error(`ENOENT: ${path}`));
    if (typeof entry === "string") return Promise.resolve(entry);
    return Promise.resolve(new TextDecoder().decode(entry));
  }

  function readBytes(path: string): Promise<Uint8Array> {
    const entry = files.get(path);
    if (entry === undefined) return Promise.reject(new Error(`ENOENT: ${path}`));
    if (entry instanceof Uint8Array) return Promise.resolve(entry);
    return Promise.resolve(new TextEncoder().encode(entry));
  }

  function write(path: string, content: string | Uint8Array): Promise<void> {
    files.set(path, content);
    return Promise.resolve();
  }

  function exists(path: string): Promise<boolean> {
    return Promise.resolve(files.has(path));
  }

  function list(path: string): Promise<string[]> {
    const prefix = path.endsWith("/") ? path : path + "/";
    const entries: string[] = [];
    for (const key of files.keys()) {
      if (key.startsWith(prefix)) {
        const relative = key.slice(prefix.length);
        if (!relative.includes("/")) entries.push(relative);
      }
    }
    return Promise.resolve(entries);
  }

  const configBase = join(xdgConfigHome(), cliName);
  const dataBase   = join(xdgDataHome(),   cliName);
  const cacheBase  = join(xdgCacheHome(),  cliName);

  return {
    files,
    read,
    readBytes,
    write,
    exists,
    list,
    configPath(...segments) { return join(configBase, ...segments); },
    dataPath(...segments)   { return join(dataBase, ...segments); },
    cachePath(...segments)  { return join(cacheBase, ...segments); },
  };
}

// ---------------------------------------------------------------------------
// XDG helpers
// ---------------------------------------------------------------------------

export function xdgConfigHome(): string {
  return process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
}

export function xdgDataHome(): string {
  return process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
}

export function xdgCacheHome(): string {
  return process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
}
