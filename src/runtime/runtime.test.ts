import { describe, it, expect } from "bun:test";
import { parseToml, serializeToml } from "./toml.ts";
import { createMockOutput } from "./output.ts";
import { createMockFs } from "./fs.ts";
import { createMockStdin } from "./stdin.ts";
import { createMockLog } from "./log.ts";
import { createMockSecrets } from "./secrets.ts";
import { createMockSignalManager } from "./signal.ts";
import { MockRuntime } from "./mock.ts";

// ---------------------------------------------------------------------------
// TOML parser
// ---------------------------------------------------------------------------

describe("parseToml", () => {
  it("parses top-level string values", () => {
    const doc = parseToml(`name = "Alice"\nage = 30\n`);
    expect(doc[""]!["name"]).toBe("Alice");
    expect(doc[""]!["age"]).toBe(30);
  });

  it("parses boolean values", () => {
    const doc = parseToml(`enabled = true\ndisabled = false\n`);
    expect(doc[""]!["enabled"]).toBe(true);
    expect(doc[""]!["disabled"]).toBe(false);
  });

  it("parses section headers", () => {
    const doc = parseToml(`[mycommand]\ntoken = "secret"\n`);
    expect(doc["mycommand"]!["token"]).toBe("secret");
  });

  it("parses top-level and section keys separately", () => {
    const src = `base_url = "https://example.com"\n\n[mycommand]\nformat = "json"\n`;
    const doc = parseToml(src);
    expect(doc[""]!["base_url"]).toBe("https://example.com");
    expect(doc["mycommand"]!["format"]).toBe("json");
  });

  it("skips comments and blank lines", () => {
    const doc = parseToml(`# a comment\n\nkey = "value"\n`);
    expect(doc[""]!["key"]).toBe("value");
    expect(Object.keys(doc[""]!)).toHaveLength(1);
  });

  it("handles single-quoted strings without escaping", () => {
    const doc = parseToml(`path = 'C:\\Users\\john'\n`);
    expect(doc[""]!["path"]).toBe("C:\\Users\\john");
  });

  it("handles basic escape sequences in double-quoted strings", () => {
    const doc = parseToml(`msg = "hello\\nworld"\n`);
    expect(doc[""]!["msg"]).toBe("hello\nworld");
  });

  it("parses float values", () => {
    const doc = parseToml(`timeout = 3.14\n`);
    expect(doc[""]!["timeout"]).toBeCloseTo(3.14);
  });

  it("returns empty top-level section for empty input", () => {
    const doc = parseToml("");
    expect(doc[""]).toEqual({});
  });
});

describe("serializeToml", () => {
  it("round-trips a simple document", () => {
    const original = `name = "Alice"\nage = 42\n`;
    const doc = parseToml(original);
    const out = serializeToml(doc);
    expect(parseToml(out)[""]!["name"]).toBe("Alice");
    expect(parseToml(out)[""]!["age"]).toBe(42);
  });

  it("round-trips sections", () => {
    const doc = parseToml(`[cmd]\ntoken = "abc"\n`);
    const out = serializeToml(doc);
    expect(parseToml(out)["cmd"]!["token"]).toBe("abc");
  });
});

// ---------------------------------------------------------------------------
// MockOutput
// ---------------------------------------------------------------------------

describe("createMockOutput", () => {
  it("records print calls", () => {
    const out = createMockOutput();
    out.print("hello");
    expect(out.calls).toEqual([{ type: "print", text: "hello" }]);
  });

  it("records printError calls", () => {
    const out = createMockOutput();
    out.printError("oops");
    expect(out.calls[0]).toMatchObject({ type: "printError", text: "oops" });
  });

  it("records success, warn, json", () => {
    const out = createMockOutput();
    out.success("done");
    out.warn("careful");
    out.json({ x: 1 });
    expect(out.calls[0]).toMatchObject({ type: "success", message: "done" });
    expect(out.calls[1]).toMatchObject({ type: "warn", message: "careful" });
    expect(out.calls[2]).toMatchObject({ type: "json", value: { x: 1 } });
  });

  it("records table and list calls", () => {
    const out = createMockOutput();
    out.table([{ name: "Alice" }]);
    out.list(["a", "b"]);
    expect(out.calls[0]).toMatchObject({ type: "table" });
    expect(out.calls[1]).toMatchObject({ type: "list", items: ["a", "b"] });
  });

  it("withSpinner resolves the fn result", async () => {
    const out = createMockOutput();
    const result = await out.withSpinner("loading", async () => 42);
    expect(result).toBe(42);
    expect(out.calls[0]).toMatchObject({ type: "spinner", message: "loading" });
  });

  it("withProgressBar resolves the fn result", async () => {
    const out = createMockOutput();
    const result = await out.withProgressBar(10, async (tick) => {
      tick(5);
      return "done";
    });
    expect(result).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// MockFs
// ---------------------------------------------------------------------------

describe("createMockFs", () => {
  it("writes and reads back a string", async () => {
    const fs = createMockFs("testcli");
    await fs.write("/tmp/test.txt", "hello");
    expect(await fs.read("/tmp/test.txt")).toBe("hello");
  });

  it("exists() returns false for missing files", async () => {
    const fs = createMockFs("testcli");
    expect(await fs.exists("/no/such/file")).toBe(false);
  });

  it("exists() returns true after write", async () => {
    const fs = createMockFs("testcli");
    await fs.write("/tmp/f", "x");
    expect(await fs.exists("/tmp/f")).toBe(true);
  });

  it("list() returns basenames of direct children", async () => {
    const fs = createMockFs("testcli");
    await fs.write("/dir/a.txt", "a");
    await fs.write("/dir/b.txt", "b");
    await fs.write("/dir/sub/c.txt", "c"); // not a direct child
    const entries = await fs.list("/dir");
    expect(entries.sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("readBytes returns Uint8Array", async () => {
    const fs = createMockFs("testcli");
    await fs.write("/tmp/bytes.bin", "abc");
    const bytes = await fs.readBytes("/tmp/bytes.bin");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes)).toBe("abc");
  });

  it("read() rejects for missing file", async () => {
    const fs = createMockFs("testcli");
    await expect(fs.read("/missing")).rejects.toThrow("ENOENT");
  });
});

// ---------------------------------------------------------------------------
// MockStdin
// ---------------------------------------------------------------------------

describe("createMockStdin", () => {
  it("read() returns the preset content", async () => {
    const stdin = createMockStdin("hello world");
    expect(await stdin.read()).toBe("hello world");
  });

  it("lines() iterates over newline-separated content", async () => {
    const stdin = createMockStdin("line1\nline2\nline3");
    const lines: string[] = [];
    for await (const line of stdin.lines()) lines.push(line);
    expect(lines).toEqual(["line1", "line2", "line3"]);
  });

  it("isTTY reflects the constructor argument", () => {
    expect(createMockStdin("", true).isTTY).toBe(true);
    expect(createMockStdin("", false).isTTY).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MockLog
// ---------------------------------------------------------------------------

describe("createMockLog", () => {
  it("records verbose and debug calls", () => {
    const log = createMockLog();
    log.verbose("v msg");
    log.debug("d msg");
    expect(log.calls).toEqual([
      { level: "verbose", message: "v msg" },
      { level: "debug",   message: "d msg" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// MockSecrets
// ---------------------------------------------------------------------------

describe("createMockSecrets", () => {
  it("get() returns undefined for missing keys", async () => {
    const s = createMockSecrets();
    expect(await s.get("key")).toBeUndefined();
  });

  it("set() and get() round-trip", async () => {
    const s = createMockSecrets();
    await s.set("token", "abc123");
    expect(await s.get("token")).toBe("abc123");
  });

  it("delete() removes the key", async () => {
    const s = createMockSecrets({ token: "abc" });
    await s.delete("token");
    expect(await s.get("token")).toBeUndefined();
  });

  it("initial values are pre-populated", async () => {
    const s = createMockSecrets({ key: "value" });
    expect(await s.get("key")).toBe("value");
  });
});

// ---------------------------------------------------------------------------
// MockSignalManager
// ---------------------------------------------------------------------------

describe("createMockSignalManager", () => {
  it("signal is not aborted initially", () => {
    const mgr = createMockSignalManager();
    expect(mgr.signal.aborted).toBe(false);
  });

  it("abort() aborts the signal", () => {
    const mgr = createMockSignalManager();
    mgr.abort();
    expect(mgr.signal.aborted).toBe(true);
  });

  it("registered handlers are stored", () => {
    const mgr = createMockSignalManager();
    const fn = () => {};
    mgr.onExit(fn);
    expect(mgr.exitHandlers).toContain(fn);
  });
});

// ---------------------------------------------------------------------------
// MockRuntime (integration)
// ---------------------------------------------------------------------------

describe("MockRuntime", () => {
  it("print() records to printed array", () => {
    const rt = new MockRuntime();
    rt.print("hello");
    expect(rt.printed).toEqual(["hello"]);
  });

  it("printError() records to errors array", () => {
    const rt = new MockRuntime();
    rt.printError("oops");
    expect(rt.errors).toEqual(["oops"]);
  });

  it("exit() throws MockExitError", () => {
    const rt = new MockRuntime();
    expect(() => rt.exit(1)).toThrow();
    expect(rt.exitCode).toBe(1);
  });

  it("args defaults have provided as empty Set", () => {
    const rt = new MockRuntime();
    expect(rt.args.provided).toBeInstanceOf(Set);
    expect(rt.args.provided.size).toBe(0);
  });

  it("accepts pre-set args", () => {
    const rt = new MockRuntime({ args: { flags: { name: "Alice" }, positionals: [], passthrough: [], provided: new Set(["name"]) } });
    expect(rt.args.flags["name"]).toBe("Alice");
    expect(rt.args.provided.has("name")).toBe(true);
  });

  it("secretStore is accessible", async () => {
    const rt = new MockRuntime({ secrets: { token: "abc" } });
    expect(await rt.secrets.get("token")).toBe("abc");
    expect(rt.secretStore.get("token")).toBe("abc");
  });

  it("fsFiles is accessible after write", async () => {
    const rt = new MockRuntime();
    await rt.fs.write("/tmp/x", "hello");
    expect(rt.fsFiles.get("/tmp/x")).toBe("hello");
  });

  it("files option pre-populates the fs", async () => {
    const rt = new MockRuntime({ files: { "/config/file.toml": "key = \"value\"" } });
    expect(await rt.fs.read("/config/file.toml")).toBe('key = "value"');
  });

  it("abort() triggers registered exit handlers", async () => {
    const rt = new MockRuntime();
    const calls: string[] = [];
    rt.onExit(() => calls.push("first"));
    rt.onExit(() => calls.push("second"));
    await rt.abort();
    // LIFO order
    expect(calls).toEqual(["second", "first"]);
  });

  it("signal starts unaborted", () => {
    const rt = new MockRuntime();
    expect(rt.signal.aborted).toBe(false);
  });

  it("outputCalls captures structured output", () => {
    const rt = new MockRuntime();
    rt.output.success("it worked");
    expect(rt.outputCalls).toContainEqual({ type: "success", message: "it worked" });
  });

  it("logCalls captures log output", () => {
    const rt = new MockRuntime();
    rt.log.verbose("something happened");
    expect(rt.logCalls).toContainEqual({ level: "verbose", message: "something happened" });
  });
});
