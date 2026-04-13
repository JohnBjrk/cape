import {
  pullImage,
  startContainer,
  execInContainer,
  interactiveShell,
  removeContainer,
  shortId,
} from "./docker.ts";
import type { Scenario, Step, StepResult, RunOpts, DebugTiming } from "./types.ts";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Identity function — gives scenario files a typed `defineScenario` import. */
export function defineScenario(scenario: Scenario): Scenario {
  return scenario;
}

export class StepFailure extends Error {
  constructor(
    public readonly step: Step,
    public readonly result: StepResult,
  ) {
    super(`Step "${step.name}" failed (exit ${result.exitCode})`);
    this.name = "StepFailure";
  }
}

export async function runScenario(
  scenario: Scenario,
  opts: RunOpts,
  repoRoot: string,
): Promise<void> {
  validateMounts(scenario, repoRoot);

  console.log(`\n▶ ${scenario.name}`);
  console.log(`  Image: ${scenario.image}`);
  console.log(`  Steps: ${scenario.steps.map((s) => s.name).join(", ")}\n`);

  await pullImage(scenario.image);

  const containerId = await startContainer(scenario.image, scenario.mounts ?? [], repoRoot);
  console.log(`  Container: cape-test-${shortId(containerId)}\n`);

  let containerRemoved = false;
  const completed: string[] = [];

  // Ensure cleanup on Ctrl+C
  const cleanup = () => {
    if (!containerRemoved) {
      Bun.spawnSync(["docker", "rm", "-f", containerId], { stdout: "pipe", stderr: "pipe" });
    }
  };
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });

  try {
    for (const step of scenario.steps) {
      // --debug-before: shell before this step runs
      if (opts.debugBefore === step.name) {
        printDebugBanner(containerId, scenario.name, step.name, "before", completed);
        await interactiveShell(containerId);
        await removeContainer(containerId);
        containerRemoved = true;
        return;
      }

      process.stdout.write(`  running: ${step.name}...`);
      const result = execInContainer(containerId, step.run);
      const passed = passes(result, step.expect);

      if (passed) {
        process.stdout.write(` ✓\n`);
        completed.push(step.name);
      } else {
        process.stdout.write(` ✗\n`);
        printStepFailure(step, result);

        if (opts.debug) {
          printDebugBanner(containerId, scenario.name, step.name, "after-failure", completed);
          await interactiveShell(containerId);
          await removeContainer(containerId);
          containerRemoved = true;
          throw new StepFailure(step, result);
        }

        throw new StepFailure(step, result);
      }

      // --debug-at: shell after this step completes
      if (opts.debugAt === step.name) {
        printDebugBanner(containerId, scenario.name, step.name, "after", completed);
        await interactiveShell(containerId);
        await removeContainer(containerId);
        containerRemoved = true;
        return;
      }
    }

    console.log(`\n✓ ${scenario.name} — all steps passed\n`);
  } finally {
    if (!containerRemoved) {
      await removeContainer(containerId);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function passes(result: StepResult, expect?: Step["expect"]): boolean {
  if (!expect) return result.exitCode === 0;

  if (expect.exitCode !== undefined && result.exitCode !== expect.exitCode) return false;
  if (!checkOutput(result.stdout, expect.stdout)) return false;
  if (!checkOutput(result.stderr, expect.stderr)) return false;

  return true;
}

function checkOutput(actual: string, expected?: RegExp | string): boolean {
  if (expected === undefined) return true;
  if (expected instanceof RegExp) return expected.test(actual);
  return actual.includes(expected);
}

function printStepFailure(step: Step, result: StepResult): void {
  console.log(`\n  Command: ${step.run}`);
  console.log(`  Exit:    ${result.exitCode}`);
  if (result.stdout.trim()) {
    console.log(`  stdout:\n${indent(result.stdout.trim(), 4)}`);
  }
  if (result.stderr.trim()) {
    console.log(`  stderr:\n${indent(result.stderr.trim(), 4)}`);
  }
}

function printDebugBanner(
  containerId: string,
  scenarioName: string,
  stepName: string,
  timing: DebugTiming,
  completed: string[],
): void {
  const line = "─".repeat(60);
  const label =
    timing === "before"
      ? `Stopped before: ${stepName}`
      : timing === "after"
        ? `Stopped after: ${stepName}`
        : `Failed at: ${stepName}`;

  console.log(`\n${line}`);
  console.log(`  ${label}`);
  console.log(`  Scenario:  ${scenarioName}`);
  console.log(`  Container: cape-test-${shortId(containerId)}`);
  if (completed.length > 0) {
    console.log(`  Completed: ${completed.join(", ")}`);
  }
  console.log(`\n  Dropping into container shell. Type \`exit\` to stop.`);
  console.log(`${line}\n`);
}

function validateMounts(scenario: Scenario, repoRoot: string): void {
  const { join, isAbsolute } = require("node:path");
  const { existsSync } = require("node:fs");

  for (const mount of scenario.mounts ?? []) {
    const resolved = isAbsolute(mount.host) ? mount.host : join(repoRoot, mount.host);
    if (!existsSync(resolved)) {
      throw new Error(
        `Mount source does not exist: ${mount.host}\n` +
          `  Resolved: ${resolved}\n` +
          `  Run the appropriate build step first.`,
      );
    }
  }
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}
