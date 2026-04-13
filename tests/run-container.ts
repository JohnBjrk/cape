import { join } from "node:path";
import { runScenario, StepFailure } from "./container/helpers/runner.ts";
import type { RunOpts } from "./container/helpers/types.ts";

// ---------------------------------------------------------------------------
// CLI flag parsing
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const opts: RunOpts = {};
const scenarioPaths: string[] = [];
let ciMode = false;

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--debug") {
    opts.debug = true;
  } else if (arg === "--debug-at") {
    opts.debugAt = argv[++i]!;
  } else if (arg === "--debug-before") {
    opts.debugBefore = argv[++i]!;
  } else if (arg === "--ci") {
    ciMode = true;
  } else if (!arg!.startsWith("--")) {
    scenarioPaths.push(arg!);
  } else {
    console.error(`Unknown flag: ${arg}`);
    printUsage();
    process.exit(1);
  }
}

// Validate debug flags require a TTY (except in CI where they shouldn't be used)
if ((opts.debug || opts.debugAt || opts.debugBefore) && !process.stdin.isTTY) {
  console.warn("Warning: debug flags work best in an interactive terminal.");
}

// ---------------------------------------------------------------------------
// Scenario discovery
//
// Naming convention:
//   *.scenario.ts        — runs everywhere (CI + local)
//   *.local.scenario.ts  — local only, skipped with --ci
//   *.ci.scenario.ts     — CI only, skipped without --ci
// ---------------------------------------------------------------------------

const repoRoot = join(import.meta.dir, "..");

async function discoverScenarios(): Promise<string[]> {
  const glob = new Bun.Glob("tests/container/scenarios/*.scenario.ts");
  const paths: string[] = [];
  for await (const file of glob.scan(repoRoot)) {
    const base = file.split("/").pop()!;
    if (ciMode && base.includes(".local.")) continue;
    if (!ciMode && base.includes(".ci.")) continue;
    paths.push(join(repoRoot, file));
  }
  return paths.sort();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const paths = scenarioPaths.length > 0 ? scenarioPaths : await discoverScenarios();

if (paths.length === 0) {
  console.log("No scenarios to run.");
  process.exit(0);
}

console.log(`Running in ${ciMode ? "CI" : "local"} mode\n`);

let failed = 0;

for (const scenarioPath of paths) {
  const mod = (await import(scenarioPath)) as { default: unknown };
  const scenario = mod.default;

  if (!scenario || typeof scenario !== "object" || !("name" in scenario)) {
    console.error(`Invalid scenario: ${scenarioPath} — must export a default defineScenario(...)`);
    process.exit(1);
  }

  try {
    await runScenario(scenario as Parameters<typeof runScenario>[0], opts, repoRoot);
  } catch (err) {
    if (err instanceof StepFailure) {
      console.error(`\n✗ Scenario "${scenario.name}" failed at step "${err.step.name}"\n`);
    } else {
      console.error(`\n✗ Scenario "${scenario.name}" error:`, err);
    }
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} scenario(s) failed.`);
  process.exit(1);
} else {
  console.log(`All scenarios passed.`);
}

// ---------------------------------------------------------------------------

function printUsage() {
  console.log(`
Usage: bun tests/run-container.ts [options] [scenario-file...]

Options:
  --ci                     CI mode: skip *.local.scenario.ts files
  --debug                  Drop into interactive shell on step failure
  --debug-at <step>        Drop into shell after step completes
  --debug-before <step>    Drop into shell before step runs

Scenario naming convention:
  *.scenario.ts            Runs everywhere (CI + local)
  *.local.scenario.ts      Local only (skipped with --ci)
  *.ci.scenario.ts         CI only (skipped without --ci)

Examples:
  bun tests/run-container.ts
  bun tests/run-container.ts --ci
  bun tests/run-container.ts --debug
  bun tests/run-container.ts --debug-at binary-is-on-path
  bun tests/run-container.ts tests/container/scenarios/install.scenario.ts
`);
}
