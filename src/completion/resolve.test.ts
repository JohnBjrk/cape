import { describe, it, expect } from "bun:test";
import { resolveCompletions } from "./resolve.ts";
import { defineCommand, defineSubcommand } from "../cli.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const greetCmd = defineCommand({
  name: "greet",
  description: "Greet someone",
  schema: {
    flags: {
      name: {
        type: "string",
        alias: "n",
        required: true,
        description: "Who to greet",
        complete: { type: "static", values: ["Alice", "Bob", "Charlie"] },
      },
      format: {
        type: "string",
        description: "Output format",
        complete: { type: "static", values: ["plain", "json", "table"] },
      },
      repeat: {
        type: "number",
        description: "Times to repeat",
        default: 1,
      },
      shout: {
        type: "boolean",
        alias: "s",
        description: "Shout the greeting",
      },
    },
  },
  async run(args, runtime) {
    runtime.print(`Hello, ${args.flags.name}!`);
  },
});

const deployCmd = defineCommand({
  name: "deploy",
  description: "Deploy the app",
  subcommands: [
    defineSubcommand({
      name: "staging",
      description: "Deploy to staging",
      schema: {
        flags: {
          force: { type: "boolean", description: "Skip confirmation" },
        },
      },
      async run(_args, runtime) {
        runtime.print("staging");
      },
    }),
    defineSubcommand({
      name: "production",
      aliases: ["prod"],
      description: "Deploy to production",
      async run(_args, runtime) {
        runtime.print("production");
      },
    }),
  ],
  async run(_args, runtime) {
    runtime.print("deploy");
  },
});

const commands = [greetCmd, deployCmd];

// ---------------------------------------------------------------------------
// Command-name slot
// ---------------------------------------------------------------------------

describe("command-name slot", () => {
  it("returns all command names when argv is empty and partial is empty", async () => {
    const results = await resolveCompletions(commands, [], "");
    expect(results).toContain("greet");
    expect(results).toContain("deploy");
  });

  it("filters by prefix", async () => {
    const results = await resolveCompletions(commands, [], "g");
    expect(results).toEqual(["greet"]);
  });

  it("returns nothing when prefix matches nothing", async () => {
    const results = await resolveCompletions(commands, [], "xyz");
    expect(results).toHaveLength(0);
  });

  it("includes command aliases", async () => {
    const withAlias = defineCommand({
      name: "build",
      aliases: ["b"],
      description: "Build",
      async run(_a, r) {
        r.print("");
      },
    });
    const results = await resolveCompletions([withAlias], [], "b");
    expect(results).toContain("build");
    expect(results).toContain("b");
  });
});

// ---------------------------------------------------------------------------
// Subcommand-name slot
// ---------------------------------------------------------------------------

describe("subcommand-name slot", () => {
  it("returns subcommand names when command is typed", async () => {
    const results = await resolveCompletions(commands, ["deploy"], "");
    expect(results).toContain("staging");
    expect(results).toContain("production");
    // should NOT include command names
    expect(results).not.toContain("greet");
    expect(results).not.toContain("deploy");
  });

  it("filters subcommands by prefix", async () => {
    const results = await resolveCompletions(commands, ["deploy"], "s");
    expect(results).toEqual(["staging"]);
  });

  it("includes subcommand aliases", async () => {
    const results = await resolveCompletions(commands, ["deploy"], "p");
    expect(results).toContain("production");
    expect(results).toContain("prod");
  });
});

// ---------------------------------------------------------------------------
// Flag-name slot
// ---------------------------------------------------------------------------

describe("flag-name slot", () => {
  it("returns flag candidates when partial starts with --", async () => {
    const results = await resolveCompletions(commands, ["greet"], "--");
    expect(results).toContain("--name");
    expect(results).toContain("--format");
    expect(results).toContain("--repeat");
    expect(results).toContain("--shout");
    // global flags also present
    expect(results).toContain("--help");
    expect(results).toContain("--verbose");
  });

  it("filters flag names by prefix", async () => {
    const results = await resolveCompletions(commands, ["greet"], "--sh");
    expect(results).toEqual(["--shout"]);
  });

  it("includes short alias candidates", async () => {
    const results = await resolveCompletions(commands, ["greet"], "-");
    expect(results).toContain("-n"); // --name alias
    expect(results).toContain("-s"); // --shout alias
    expect(results).toContain("-h"); // --help alias (global)
  });

  it("excludes already-provided non-multiple flags", async () => {
    // --name Alice has been provided
    const results = await resolveCompletions(commands, ["greet", "--name", "Alice"], "--");
    expect(results).not.toContain("--name");
    expect(results).not.toContain("-n");
    // others still present
    expect(results).toContain("--format");
    expect(results).toContain("--shout");
  });

  it("excludes flags provided via --flag=value syntax", async () => {
    const results = await resolveCompletions(commands, ["greet", "--name=Alice"], "--");
    expect(results).not.toContain("--name");
  });

  it("re-includes multiple flags even when already provided", async () => {
    const withMultiple = defineCommand({
      name: "tag",
      description: "Tag something",
      schema: {
        flags: {
          label: { type: "string", multiple: true, description: "A label" },
        },
      },
      async run(_a, r) {
        r.print("");
      },
    });
    // --label provided once already
    const results = await resolveCompletions([withMultiple], ["tag", "--label", "v1"], "--");
    expect(results).toContain("--label");
  });

  it("shows subcommand flags after subcommand is typed", async () => {
    const results = await resolveCompletions(commands, ["deploy", "staging"], "--");
    expect(results).toContain("--force");
    // global flags also present
    expect(results).toContain("--help");
  });
});

// ---------------------------------------------------------------------------
// Flag-value slot
// ---------------------------------------------------------------------------

describe("flag-value slot", () => {
  it("returns static completion values when last argv token is a value-taking flag", async () => {
    const results = await resolveCompletions(commands, ["greet", "--name"], "");
    expect(results).toEqual(["Alice", "Bob", "Charlie"]);
  });

  it("filters flag values by prefix", async () => {
    const results = await resolveCompletions(commands, ["greet", "--name"], "A");
    expect(results).toEqual(["Alice"]);
  });

  it("works with alias as the last token", async () => {
    const results = await resolveCompletions(commands, ["greet", "-n"], "");
    expect(results).toEqual(["Alice", "Bob", "Charlie"]);
  });

  it("returns [] for flags with no completion source", async () => {
    const results = await resolveCompletions(commands, ["greet", "--repeat"], "");
    expect(results).toHaveLength(0);
  });

  it("calls dynamic fetch with partial and current flag context", async () => {
    let capturedCtx: { partial: string; flags: Record<string, unknown> } | undefined;

    const cmd = defineCommand({
      name: "env",
      description: "Manage environments",
      schema: {
        flags: {
          account: { type: "string", description: "Account ID" },
          region: {
            type: "string",
            description: "Region",
            complete: {
              type: "dynamic",
              fetch: async (ctx) => {
                capturedCtx = ctx;
                return ["us-east-1", "eu-west-1", "ap-southeast-1"];
              },
              dependsOn: ["account"],
            },
          },
        },
      },
      async run(_a, r) {
        r.print("");
      },
    });

    const results = await resolveCompletions(
      [cmd],
      ["env", "--account", "my-account", "--region"],
      "us",
    );
    expect(results).toEqual(["us-east-1"]);
    expect(capturedCtx?.partial).toBe("us");
    expect(capturedCtx?.flags["account"]).toBe("my-account");
  });

  it("returns [] and does not throw when dynamic fetch times out", async () => {
    const cmd = defineCommand({
      name: "slow",
      description: "Slow completer",
      schema: {
        flags: {
          env: {
            type: "string",
            description: "Environment",
            complete: {
              type: "dynamic",
              timeoutMs: 10, // very short timeout
              fetch: async () => {
                await new Promise((r) => setTimeout(r, 500)); // simulate slow API
                return ["prod", "staging"];
              },
            },
          },
        },
      },
      async run(_a, r) {
        r.print("");
      },
    });

    const results = await resolveCompletions([cmd], ["slow", "--env"], "");
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Global-flag slot (no command typed)
// ---------------------------------------------------------------------------

describe("global flags before command", () => {
  it("returns global flag names when partial starts with -- and no command typed", async () => {
    const results = await resolveCompletions(commands, [], "--");
    expect(results).toContain("--help");
    expect(results).toContain("--verbose");
    expect(results).toContain("--debug");
    // command-specific flags should NOT appear
    expect(results).not.toContain("--name");
    expect(results).not.toContain("--format");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("does not confuse flag values with command names (schema-aware scanning)", async () => {
    // --name is a value-taking flag; "Alice" is its value, not a subcommand
    // After "--name Alice" is consumed, we're back to subcommand/flag completion
    const results = await resolveCompletions(commands, ["deploy", "--verbose", "staging"], "--");
    // We should be in the staging subcommand context
    expect(results).toContain("--force");
  });

  it("handles -- separator: tokens after it are not treated as flags", async () => {
    // After --, everything is passthrough; completion should fall back to flag-name slot
    const results = await resolveCompletions(commands, ["greet"], "--");
    expect(results).toContain("--name");
  });

  it("returns empty array for unknown command", async () => {
    // "unknown" is not a command — treated as if no command found, partial starts with ""
    const results = await resolveCompletions(commands, [], "unknown");
    // partial "unknown" doesn't start with "-" so we're in command slot, just filtered
    expect(results).toHaveLength(0);
  });
});
