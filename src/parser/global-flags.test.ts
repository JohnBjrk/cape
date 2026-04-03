import { describe, it, expect } from "bun:test";
import { globalSchema, mergeSchemas, extractGlobalFlags } from "./global-flags.ts";
import { resolve } from "./resolve.ts";
import { tokenize } from "./tokenize.ts";
import type { ArgSchema } from "./types.ts";

function parse(argv: string[], schema = globalSchema) {
  return resolve(tokenize(argv), schema);
}

describe("globalSchema", () => {
  it("parses --help", () => {
    expect(parse(["--help"]).flags.help).toBe(true);
  });

  it("parses -h as help", () => {
    expect(parse(["-h"]).flags.help).toBe(true);
  });

  it("parses --json", () => {
    expect(parse(["--json"]).flags.json).toBe(true);
  });

  it("parses --no-color", () => {
    expect(parse(["--no-color"]).flags["no-color"]).toBe(true);
  });

  it("parses --quiet / -q", () => {
    expect(parse(["--quiet"]).flags.quiet).toBe(true);
    expect(parse(["-q"]).flags.quiet).toBe(true);
  });

  it("parses --verbose / -v", () => {
    expect(parse(["--verbose"]).flags.verbose).toBe(true);
    expect(parse(["-v"]).flags.verbose).toBe(true);
  });

  it("parses --debug", () => {
    expect(parse(["--debug"]).flags.debug).toBe(true);
  });

  it("parses --config with a path value", () => {
    expect(parse(["--config", "/tmp/my.toml"]).flags.config).toBe("/tmp/my.toml");
  });
});

describe("mergeSchemas", () => {
  it("includes flags from both schemas", () => {
    const command: ArgSchema = { flags: { env: { type: "string" } } };
    const merged = mergeSchemas(globalSchema, command);
    expect(merged.flags).toHaveProperty("help");
    expect(merged.flags).toHaveProperty("env");
  });

  it("command flag wins over global flag on name collision", () => {
    const command: ArgSchema = {
      flags: { verbose: { type: "string", description: "Custom verbose" } },
    };
    const merged = mergeSchemas(globalSchema, command);
    expect(merged.flags!["verbose"]!.type).toBe("string");
  });

  it("carries positionals from the command schema only", () => {
    const command: ArgSchema = {
      flags: {},
      positionals: [{ name: "service" }],
    };
    const merged = mergeSchemas(globalSchema, command);
    expect(merged.positionals).toHaveLength(1);
    expect(merged.positionals![0]!.name).toBe("service");
  });
});

describe("extractGlobalFlags", () => {
  it("returns typed values for all global flags", () => {
    const parsed = parse(["--json", "--no-color", "--config", "/tmp/x.toml"]);
    const globals = extractGlobalFlags(parsed);
    expect(globals.json).toBe(true);
    expect(globals.noColor).toBe(true);
    expect(globals.config).toBe("/tmp/x.toml");
    expect(globals.help).toBe(false);
  });

  it("--debug implies verbose: true", () => {
    const parsed = parse(["--debug"]);
    const globals = extractGlobalFlags(parsed);
    expect(globals.debug).toBe(true);
    expect(globals.verbose).toBe(true);
  });

  it("verbose is false when neither --verbose nor --debug is set", () => {
    const parsed = parse([]);
    const globals = extractGlobalFlags(parsed);
    expect(globals.verbose).toBe(false);
    expect(globals.debug).toBe(false);
  });
});
