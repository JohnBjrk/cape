import { describe, it, expect } from "bun:test";
import { renderHelp } from "./render.ts";
import type { CliInfo, HelpContext } from "./types.ts";
import type { ArgSchema } from "../parser/types.ts";

const cli: CliInfo = { name: "myctl", version: "1.0.0", description: "Manage your resources" };
const noColor = { noColor: true };

const generateSchema: ArgSchema = {
  flags: {
    output: { type: "string", alias: "o", description: "Output directory", default: "./dist" },
    format: { type: "string", description: "Output format", hideInSubcommandHelp: true },
  },
};

const certSchema: ArgSchema = {
  flags: {
    ca: { type: "string", description: "Path to CA certificate" },
    days: { type: "number", description: "Validity period in days", default: 365 },
  },
};

describe("renderHelp — root level", () => {
  const ctx: HelpContext = {
    level: "root",
    commands: [
      { name: "generate", description: "Generate certificates and keys" },
      { name: "deploy", description: "Deploy services", aliases: ["d"] },
    ],
  };

  it("includes CLI name and version in header", () => {
    const out = renderHelp(cli, ctx, noColor);
    expect(out).toContain("myctl v1.0.0");
    expect(out).toContain("Manage your resources");
  });

  it("shows usage line", () => {
    const out = renderHelp(cli, ctx, noColor);
    expect(out).toContain("Usage: myctl <command> [subcommand] [flags]");
  });

  it("lists commands", () => {
    const out = renderHelp(cli, ctx, noColor);
    expect(out).toContain("generate");
    expect(out).toContain("Generate certificates and keys");
    expect(out).toContain("deploy");
  });

  it("shows command alias in the commands list", () => {
    const out = renderHelp(cli, ctx, noColor);
    expect(out).toContain("deploy, d");
  });

  it("shows global flags section", () => {
    const out = renderHelp(cli, ctx, noColor);
    expect(out).toContain("Global Flags:");
    expect(out).toContain("--help, -h");
    expect(out).toContain("--json");
  });

  it("includes footer hint", () => {
    const out = renderHelp(cli, ctx, noColor);
    expect(out).toContain("myctl <command> --help");
  });
});

describe("renderHelp — command level", () => {
  const ctx: HelpContext = {
    level: "command",
    command: {
      name: "generate",
      description: "Generate certificates and keys",
      schema: generateSchema,
    },
    subcommands: [{ name: "certificate", description: "Generate a TLS certificate" }],
  };

  it("shows command name and description in header", () => {
    const out = renderHelp(cli, ctx, noColor);
    expect(out).toContain("generate — Generate certificates and keys");
  });

  it("shows usage line with subcommand placeholder", () => {
    const out = renderHelp(cli, ctx, noColor);
    expect(out).toContain("Usage: myctl generate <subcommand> [flags]");
  });

  it("lists subcommands", () => {
    const out = renderHelp(cli, ctx, noColor);
    expect(out).toContain("Subcommands:");
    expect(out).toContain("certificate");
  });

  it("shows command flags", () => {
    const out = renderHelp(cli, ctx, noColor);
    expect(out).toContain("Command Flags:");
    expect(out).toContain("--output, -o <string>");
    expect(out).toContain("(default: ./dist)");
  });

  it("shows global flags", () => {
    const out = renderHelp(cli, ctx, noColor);
    expect(out).toContain("Global Flags:");
    expect(out).toContain("--json");
  });

  it("does not duplicate global flags in command flags section", () => {
    const out = renderHelp(cli, ctx, noColor);
    const commandFlagsSection = out.split("Global Flags:")[0]!;
    expect(commandFlagsSection).not.toContain("--help");
  });
});

describe("renderHelp — subcommand level", () => {
  const ctx: HelpContext = {
    level: "subcommand",
    command: {
      name: "generate",
      description: "Generate certificates and keys",
      schema: generateSchema,
    },
    subcommand: {
      name: "certificate",
      description: "Generate a TLS certificate",
      schema: certSchema,
    },
  };

  it("shows both command and subcommand name in header", () => {
    const out = renderHelp(cli, ctx, noColor);
    expect(out).toContain("generate certificate — Generate a TLS certificate");
  });

  it("shows usage line with full command path", () => {
    const out = renderHelp(cli, ctx, noColor);
    expect(out).toContain("Usage: myctl generate certificate [flags]");
  });

  it("shows subcommand flags", () => {
    const out = renderHelp(cli, ctx, noColor);
    expect(out).toContain("Flags:");
    expect(out).toContain("--ca <string>");
    expect(out).toContain("--days <number>");
    expect(out).toContain("(default: 365)");
  });

  it("shows inherited command flags", () => {
    const out = renderHelp(cli, ctx, noColor);
    expect(out).toContain("Inherited from 'generate':");
    expect(out).toContain("--output, -o <string>");
  });

  it("excludes flags with hideInSubcommandHelp from inherited section", () => {
    const out = renderHelp(cli, ctx, noColor);
    const inheritedSection = out.split("Inherited from")[1]!;
    expect(inheritedSection).not.toContain("--format");
  });

  it("shows global flags", () => {
    const out = renderHelp(cli, ctx, noColor);
    expect(out).toContain("Global Flags:");
    expect(out).toContain("--json");
  });

  it("has no footer hint at subcommand level", () => {
    const out = renderHelp(cli, ctx, noColor);
    expect(out).not.toContain("--help'");
  });
});

describe("renderHelp — multiple flag", () => {
  it("appends ... to the type hint for multiple flags", () => {
    const schema: ArgSchema = {
      flags: { service: { type: "string", multiple: true, description: "Target service" } },
    };
    const ctx: HelpContext = {
      level: "command",
      command: { name: "deploy", description: "Deploy", schema },
      subcommands: [],
    };
    const out = renderHelp(cli, ctx, noColor);
    expect(out).toContain("--service <string>...");
  });
});
