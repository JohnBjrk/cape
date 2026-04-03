import { describe, it, expect } from "bun:test";
import { tokenize } from "./tokenize.ts";

describe("tokenize", () => {
  it("produces value tokens for plain args", () => {
    expect(tokenize(["foo", "bar"])).toEqual([
      { type: "value", raw: "foo" },
      { type: "value", raw: "bar" },
    ]);
  });

  it("produces flag tokens for --long flags", () => {
    expect(tokenize(["--verbose"])).toEqual([
      { type: "flag", raw: "--verbose" },
    ]);
  });

  it("produces flag tokens for -short flags", () => {
    expect(tokenize(["-v"])).toEqual([
      { type: "flag", raw: "-v" },
    ]);
  });

  it("splits --flag=value into flag + value tokens", () => {
    expect(tokenize(["--output=dist"])).toEqual([
      { type: "flag", raw: "--output" },
      { type: "value", raw: "dist" },
    ]);
  });

  it("handles = in the value correctly", () => {
    expect(tokenize(["--filter=a=b"])).toEqual([
      { type: "flag", raw: "--filter" },
      { type: "value", raw: "a=b" },
    ]);
  });

  it("expands -abc cluster into individual flag tokens", () => {
    expect(tokenize(["-abc"])).toEqual([
      { type: "flag", raw: "-a" },
      { type: "flag", raw: "-b" },
      { type: "flag", raw: "-c" },
    ]);
  });

  it("emits separator token for -- and makes subsequent args values", () => {
    expect(tokenize(["--verbose", "--", "--not-a-flag", "value"])).toEqual([
      { type: "flag", raw: "--verbose" },
      { type: "separator", raw: "--" },
      { type: "value", raw: "--not-a-flag" },
      { type: "value", raw: "value" },
    ]);
  });

  it("handles empty argv", () => {
    expect(tokenize([])).toEqual([]);
  });

  it("handles mixed args", () => {
    expect(tokenize(["deploy", "--env", "staging", "-v"])).toEqual([
      { type: "value", raw: "deploy" },
      { type: "flag", raw: "--env" },
      { type: "value", raw: "staging" },
      { type: "flag", raw: "-v" },
    ]);
  });
});
