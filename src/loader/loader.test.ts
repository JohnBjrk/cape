import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { discoverPlugins } from "./discover.ts";
import { loadPlugin, FRAMEWORK_VERSION } from "./load.ts";

const FIXTURES = join(import.meta.dir, "fixtures");

describe("discoverPlugins", () => {
  it("finds *.plugin.toml files in a directory", async () => {
    const plugins = await discoverPlugins([join(FIXTURES, "valid-plugin")]);
    expect(plugins).toHaveLength(1);
    expect(plugins[0]!.manifest.name).toBe("greet");
  });

  it("skips disabled plugins", async () => {
    const plugins = await discoverPlugins([join(FIXTURES, "disabled-plugin")]);
    expect(plugins).toHaveLength(0);
  });

  it("finds plugins recursively in nested directories", async () => {
    const plugins = await discoverPlugins([join(FIXTURES, "nested")]);
    expect(plugins).toHaveLength(1);
    expect(plugins[0]!.manifest.name).toBe("deep");
  });

  it("silently skips directories that don't exist", async () => {
    const plugins = await discoverPlugins(["/nonexistent/path/xyz"]);
    expect(plugins).toHaveLength(0);
  });

  it("deduplicates plugins by name — first directory wins", async () => {
    const plugins = await discoverPlugins([
      join(FIXTURES, "valid-plugin"),
      join(FIXTURES, "valid-plugin"), // same dir twice
    ]);
    expect(plugins).toHaveLength(1);
  });

  it("scans multiple directories and merges results", async () => {
    const plugins = await discoverPlugins([
      join(FIXTURES, "valid-plugin"),
      join(FIXTURES, "nested"),
    ]);
    expect(plugins).toHaveLength(2);
    const names = plugins.map((p) => p.manifest.name).sort();
    expect(names).toEqual(["deep", "greet"]);
  });

  it("parses manifest fields correctly", async () => {
    const plugins = await discoverPlugins([join(FIXTURES, "valid-plugin")]);
    const m = plugins[0]!.manifest;
    expect(m.name).toBe("greet");
    expect(m.description).toBe("Greet someone");
    expect(m.command).toBe("./greet.ts");
    expect(m.enabled).toBe(true);
    expect(m.frameworkVersion).toBe(FRAMEWORK_VERSION);
  });
});

describe("loadPlugin", () => {
  it("loads a valid plugin and returns a CommandDef", async () => {
    const [plugin] = await discoverPlugins([join(FIXTURES, "valid-plugin")]);
    const cmd = await loadPlugin(plugin!, "run");
    expect(cmd.name).toBe("greet");
    expect(typeof cmd.run).toBe("function");
  });

  it("throws on major version mismatch", async () => {
    const [plugin] = await discoverPlugins([join(FIXTURES, "valid-plugin")]);
    const incompatible = {
      ...plugin!,
      manifest: { ...plugin!.manifest, frameworkVersion: "99.0.0" },
    };
    await expect(loadPlugin(incompatible, "run")).rejects.toThrow(
      "requires framework v99.x",
    );
  });

  it("throws on invalid frameworkVersion format", async () => {
    const [plugin] = await discoverPlugins([join(FIXTURES, "valid-plugin")]);
    const bad = {
      ...plugin!,
      manifest: { ...plugin!.manifest, frameworkVersion: "not-semver" },
    };
    await expect(loadPlugin(bad, "run")).rejects.toThrow("invalid frameworkVersion");
  });
});
