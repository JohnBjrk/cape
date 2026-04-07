import { describe, it, expect } from "bun:test";
import { parseKey, parseKeys } from "./input.ts";

// Helper: convert string to byte array
const bytes = (s: string) => Array.from(Buffer.from(s));

describe("parseKey", () => {
  it("returns null for empty buffer", () => {
    expect(parseKey([])).toBeNull();
  });

  it("parses regular printable characters", () => {
    expect(parseKey(bytes("a"))).toEqual({ key: { type: "char", char: "a" }, consumed: 1 });
    expect(parseKey(bytes("Z"))).toEqual({ key: { type: "char", char: "Z" }, consumed: 1 });
    expect(parseKey(bytes(" "))).toEqual({ key: { type: "char", char: " " }, consumed: 1 });
  });

  it("parses Enter (\\r)", () => {
    expect(parseKey([13])).toEqual({ key: { type: "enter" }, consumed: 1 });
  });

  it("parses Enter (\\n)", () => {
    expect(parseKey([10])).toEqual({ key: { type: "enter" }, consumed: 1 });
  });

  it("parses Backspace (DEL, 0x7f)", () => {
    expect(parseKey([127])).toEqual({ key: { type: "backspace" }, consumed: 1 });
  });

  it("parses Backspace (BS, 0x08)", () => {
    expect(parseKey([8])).toEqual({ key: { type: "backspace" }, consumed: 1 });
  });

  it("parses Tab", () => {
    expect(parseKey([9])).toEqual({ key: { type: "tab" }, consumed: 1 });
  });

  it("parses Ctrl+C as interrupt", () => {
    expect(parseKey([3])).toEqual({ key: { type: "interrupt" }, consumed: 1 });
  });

  it("parses Ctrl+D as interrupt", () => {
    expect(parseKey([4])).toEqual({ key: { type: "interrupt" }, consumed: 1 });
  });

  it("parses arrow keys (ESC [ A/B/C/D)", () => {
    expect(parseKey([27, 91, 65])).toEqual({ key: { type: "up" }, consumed: 3 });
    expect(parseKey([27, 91, 66])).toEqual({ key: { type: "down" }, consumed: 3 });
    expect(parseKey([27, 91, 67])).toEqual({ key: { type: "right" }, consumed: 3 });
    expect(parseKey([27, 91, 68])).toEqual({ key: { type: "left" }, consumed: 3 });
  });

  it("parses Home and End (ESC [ H/F)", () => {
    expect(parseKey([27, 91, 72])).toEqual({ key: { type: "home" }, consumed: 3 });
    expect(parseKey([27, 91, 70])).toEqual({ key: { type: "end" }, consumed: 3 });
  });

  it("parses Delete (ESC [ 3 ~)", () => {
    expect(parseKey([27, 91, 51, 126])).toEqual({ key: { type: "delete" }, consumed: 4 });
  });

  it("parses Home alternative (ESC [ 1 ~)", () => {
    expect(parseKey([27, 91, 49, 126])).toEqual({ key: { type: "home" }, consumed: 4 });
  });

  it("parses End alternative (ESC [ 4 ~)", () => {
    expect(parseKey([27, 91, 52, 126])).toEqual({ key: { type: "end" }, consumed: 4 });
  });

  it("parses lone Escape key", () => {
    expect(parseKey([27])).toEqual({ key: { type: "escape" }, consumed: 1 });
  });

  it("returns null for incomplete ESC sequence", () => {
    expect(parseKey([27, 91])).toBeNull();
  });

  it("parses SS3 arrow keys (ESC O A/B/C/D)", () => {
    expect(parseKey([27, 79, 65])).toEqual({ key: { type: "up" }, consumed: 3 });
    expect(parseKey([27, 79, 66])).toEqual({ key: { type: "down" }, consumed: 3 });
  });
});

describe("parseKeys", () => {
  it("parses multiple keys from a single chunk", () => {
    // "hi" followed by Enter
    const chunk = Buffer.from([104, 105, 13]);
    const keys = parseKeys(chunk);
    expect(keys).toHaveLength(3);
    expect(keys[0]).toEqual({ type: "char", char: "h" });
    expect(keys[1]).toEqual({ type: "char", char: "i" });
    expect(keys[2]).toEqual({ type: "enter" });
  });

  it("parses an arrow key sequence embedded in text", () => {
    // 'a' + ESC[A (up) + 'b'
    const chunk = Buffer.from([97, 27, 91, 65, 98]);
    const keys = parseKeys(chunk);
    expect(keys).toHaveLength(3);
    expect(keys[0]).toEqual({ type: "char", char: "a" });
    expect(keys[1]).toEqual({ type: "up" });
    expect(keys[2]).toEqual({ type: "char", char: "b" });
  });

  it("returns empty array for empty chunk", () => {
    expect(parseKeys(Buffer.alloc(0))).toHaveLength(0);
  });
});
