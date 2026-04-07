import { describe, it, expect } from "bun:test";
import { resolve, ParseError } from "./resolve.ts";
import { tokenize } from "./tokenize.ts";
import type { ArgSchema } from "./types.ts";

function parse(argv: string[], schema: ArgSchema) {
  return resolve(tokenize(argv), schema);
}

const basicSchema: ArgSchema = {
  flags: {
    env: { type: "string", alias: "e", description: "Target environment" },
    count: { type: "number", description: "Number of items" },
    verbose: { type: "boolean", alias: "v", description: "Verbose output" },
  },
};

describe("resolve — happy path", () => {
  it("parses a string flag", () => {
    const result = parse(["--env", "staging"], basicSchema);
    expect(result.flags.env).toBe("staging");
  });

  it("parses a string flag via alias", () => {
    const result = parse(["-e", "staging"], basicSchema);
    expect(result.flags.env).toBe("staging");
  });

  it("parses --flag=value form", () => {
    const result = parse(["--env=staging"], basicSchema);
    expect(result.flags.env).toBe("staging");
  });

  it("parses a number flag", () => {
    const result = parse(["--count", "5"], basicSchema);
    expect(result.flags.count).toBe(5);
  });

  it("parses a boolean flag", () => {
    const result = parse(["--verbose"], basicSchema);
    expect(result.flags.verbose).toBe(true);
  });

  it("parses a boolean flag via alias", () => {
    const result = parse(["-v"], basicSchema);
    expect(result.flags.verbose).toBe(true);
  });

  it("defaults boolean to false when not provided", () => {
    const result = parse([], basicSchema);
    expect(result.flags.verbose).toBe(false);
  });

  it("collects positionals", () => {
    const result = parse(["api"], basicSchema);
    expect(result.positionals).toEqual(["api"]);
  });

  it("collects passthrough tokens after --", () => {
    const result = parse(["--verbose", "--", "--not-a-flag", "raw"], basicSchema);
    expect(result.flags.verbose).toBe(true);
    expect(result.passthrough).toEqual(["--not-a-flag", "raw"]);
  });

  it("applies a default value", () => {
    const schema: ArgSchema = {
      flags: { format: { type: "string", default: "pem" } },
    };
    const result = parse([], schema);
    expect(result.flags.format).toBe("pem");
  });

  it("user value overrides default", () => {
    const schema: ArgSchema = {
      flags: { format: { type: "string", default: "pem" } },
    };
    const result = parse(["--format", "der"], schema);
    expect(result.flags.format).toBe("der");
  });
});

describe("resolve — multiple flags", () => {
  const schema: ArgSchema = {
    flags: { service: { type: "string", multiple: true } },
  };

  it("collects repeated flags into an array", () => {
    const result = parse(["--service", "api", "--service", "worker"], schema);
    expect(result.flags.service).toEqual(["api", "worker"]);
  });

  it("single occurrence is still an array", () => {
    const result = parse(["--service", "api"], schema);
    expect(result.flags.service).toEqual(["api"]);
  });

  it("defaults to empty array when not provided", () => {
    const result = parse([], schema);
    expect(result.flags.service).toEqual([]);
  });
});

describe("resolve — validation errors", () => {
  it("throws ParseError for unknown flag", () => {
    expect(() => parse(["--unknown"], basicSchema)).toThrow(ParseError);
    expect(() => parse(["--unknown"], basicSchema)).toThrow("unknown flag --unknown");
  });

  it("includes did-you-mean suggestion for close typos", () => {
    try {
      parse(["--envv"], basicSchema);
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).suggestion).toBe("did you mean --env?");
    }
  });

  it("throws ParseError for wrong type on number flag", () => {
    expect(() => parse(["--count", "abc"], basicSchema)).toThrow(ParseError);
    expect(() => parse(["--count", "abc"], basicSchema)).toThrow(
      '--count expects a number, got "abc"',
    );
  });

  it("throws ParseError when string flag has no value", () => {
    expect(() => parse(["--env"], basicSchema)).toThrow(ParseError);
    expect(() => parse(["--env"], basicSchema)).toThrow("flag --env requires a value");
  });

  it("throws ParseError for missing required flag", () => {
    const schema: ArgSchema = {
      flags: { token: { type: "string", required: true } },
    };
    expect(() => parse([], schema)).toThrow(ParseError);
    expect(() => parse([], schema)).toThrow("missing required flag --token");
  });

  it("throws ParseError for missing required positional", () => {
    const schema: ArgSchema = {
      positionals: [{ name: "service" }],
    };
    expect(() => parse([], schema)).toThrow(ParseError);
    expect(() => parse([], schema)).toThrow("missing required argument <service>");
  });

  it("does not suggest did-you-mean for distant typos", () => {
    try {
      parse(["--completelywrong"], basicSchema);
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).suggestion).toBeUndefined();
    }
  });
});
