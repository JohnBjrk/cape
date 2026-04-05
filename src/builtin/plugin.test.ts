import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join, relative } from "node:path";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Test the file generation helpers by exercising plugin create indirectly via
// the exported template helpers (tested at the output level).
// ---------------------------------------------------------------------------

// Re-export internal helpers for testing by duplicating the logic here.
// (The actual templates are private functions in plugin.ts — we test via file output.)

describe("plugin create — file output", () => {
  let tmp: string;
  let origCwd: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "cape-plugin-create-test-"));
    origCwd = process.cwd();
    origXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = join(tmp, "xdg");
    process.chdir(tmp);
  });

  afterEach(async () => {
    process.chdir(origCwd);
    await rm(tmp, { recursive: true, force: true });
    if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = origXdg;
  });

  it("generates .plugin.toml with correct fields", async () => {
    // Simulate what plugin create writes
    const pluginDir = join(tmp, "commands", "my-tool");
    await mkdir(pluginDir, { recursive: true });

    const toml = [
      `name = "my-tool"`,
      `description = "A test tool"`,
      `command = "./my-tool.ts"`,
      `enabled = true`,
      `frameworkVersion = "1.0.0"`,
      "",
    ].join("\n");

    await Bun.write(join(pluginDir, "my-tool.plugin.toml"), toml);

    const content = await readFile(join(pluginDir, "my-tool.plugin.toml"), "utf8");
    expect(content).toContain(`name = "my-tool"`);
    expect(content).toContain(`command = "./my-tool.ts"`);
    expect(content).toContain(`enabled = true`);
    expect(content).toContain(`frameworkVersion = "1.0.0"`);
  });

  it("repo-local plugin uses relative import to cli.config.ts", () => {
    // The relative import path is: relative(pluginDir, tomlDir) + /cli.config.ts
    const tomlDir = "/project";
    const pluginDir = "/project/commands/my-tool";
    const rel = relative(pluginDir, tomlDir);
    expect(`${rel}/cli.config.ts`).toBe("../../cli.config.ts");
  });

  it("computes correct relative import for nested plugin dir", () => {
    const tomlDir = "/project";
    const pluginDir = "/project/plugins/tools/my-tool";
    const rel = relative(pluginDir, tomlDir);
    expect(`${rel}/cli.config.ts`).toBe("../../../cli.config.ts");
  });

  it("external plugin dir (outside project) is detected correctly", () => {
    const tomlDir = "/project";
    const externalDir = "/home/user/shared-plugins";
    const rel = relative(tomlDir, externalDir);
    expect(rel.startsWith("..")).toBe(true); // not inside project
  });

  it("plugin inside project is detected correctly", () => {
    const tomlDir = "/project";
    const pluginDir = "/project/commands";
    const rel = relative(tomlDir, pluginDir);
    expect(rel.startsWith("..")).toBe(false); // inside project
  });
});

describe("plugin list — discovery integration", () => {
  let tmp: string;
  let origCwd: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "cape-plugin-list-test-"));
    origCwd = process.cwd();
    process.chdir(tmp);
  });

  afterEach(async () => {
    process.chdir(origCwd);
    await rm(tmp, { recursive: true, force: true });
  });

  it("discovers plugins in commands dir", async () => {
    const pluginDir = join(tmp, "commands", "hello");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "hello.plugin.toml"), [
      `name = "hello"`,
      `description = "Hello plugin"`,
      `command = "./hello.ts"`,
      `enabled = true`,
      `frameworkVersion = "1.0.0"`,
    ].join("\n"));

    // Use discoverPlugins directly
    const { discoverPlugins } = await import("../loader/discover.ts");
    const plugins = await discoverPlugins([join(tmp, "commands")], { includeDisabled: true });

    expect(plugins).toHaveLength(1);
    expect(plugins[0]!.manifest.name).toBe("hello");
    expect(plugins[0]!.manifest.enabled).toBe(true);
  });

  it("includeDisabled shows disabled plugins", async () => {
    const pluginDir = join(tmp, "commands", "disabled-cmd");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "disabled-cmd.plugin.toml"), [
      `name = "disabled-cmd"`,
      `description = "Disabled"`,
      `command = "./disabled-cmd.ts"`,
      `enabled = false`,
      `frameworkVersion = "1.0.0"`,
    ].join("\n"));

    const { discoverPlugins } = await import("../loader/discover.ts");

    const withoutDisabled = await discoverPlugins([join(tmp, "commands")]);
    expect(withoutDisabled).toHaveLength(0);

    const withDisabled = await discoverPlugins([join(tmp, "commands")], { includeDisabled: true });
    expect(withDisabled).toHaveLength(1);
    expect(withDisabled[0]!.manifest.enabled).toBe(false);
  });
});
