import { test, expect, afterAll } from "bun:test";
import { TestEnv } from "../helpers/env.ts";

// Scenario: cape build and running the compiled binary.
// On linux/x64, Bun.build() has a known ELF issue when called from within
// a compiled binary — the test is skipped there if bun is not available as
// a fallback. On macOS and linux with bun installed it runs normally.

const isLinuxX64 = process.platform === "linux" && process.arch === "x64";
const hasBun = !!Bun.which("bun");
const canBuild = !isLinuxX64 || hasBun;

const env = await TestEnv.create();
afterAll(() => env.cleanup());

test("cape init for build scenario", async () => {
  const r = await env.exec(["cape", "init", "--name", "my-tool", "--yes"]);
  expect(r.exitCode).toBe(0);
});

test.if(canBuild)("cape build produces a binary", async () => {
  const r = await env.exec(["cape", "build"], { cwd: "my-tool" });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("Built:");
  expect(await env.exists("my-tool/dist/my-tool")).toBe(true);
});

test.if(canBuild)("compiled binary runs correctly", async () => {
  const r = await env.exec(["./dist/my-tool", "hello", "--name", "World"], { cwd: "my-tool" });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("Hello, World!");
});

test.if(canBuild)("compiled binary shows help", async () => {
  const r = await env.exec(["./dist/my-tool", "--help"], { cwd: "my-tool" });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("hello");
});

test.if(canBuild)("compiled binary shows version", async () => {
  const r = await env.exec(["./dist/my-tool", "--version"], { cwd: "my-tool" });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("my-tool 0.1.0");
});
