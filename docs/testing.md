# Testing Strategy

Cape has two distinct testing layers that serve different purposes and run at different points in the development workflow.

---

## Layer 1 — Framework tests (Bun/TypeScript)

**Purpose:** Test Cape's framework behavior — scaffolding, command parsing, plugin discovery, config validation, `cape run`. Fast feedback during development.

**Isolation:** Each test creates a temporary directory and an isolated `HOME` via environment variables. This is sufficient for testing logic; it is not a clean OS.

**Runner:** `bun test`

**Structure:** Tests are organized as *scenarios* — sequential user journeys that share state within a file. Bun runs tests within a file sequentially by default, which maps naturally to this.

```ts
// tests/scenarios/quickstart.test.ts
import { TestEnv } from "../helpers/env.ts";

const env = await TestEnv.create(); // temp dir + isolated HOME

afterAll(() => env.cleanup());

test("init scaffolds a project", async () => {
  const r = await env.exec(["cape", "init", "my-tool", "--yes"]);
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("Created my-tool/");
});

test("run executes a command", async () => {
  const r = await env.exec(["cape", "run", "hello", "--", "--name", "World"], {
    cwd: "my-tool",
  });
  expect(r.stdout).toContain("Hello, World!");
});

test("build produces a binary", async () => {
  const r = await env.exec(["cape", "build"], { cwd: "my-tool" });
  expect(r.exitCode).toBe(0);
  expect(await env.exists("my-tool/dist/my-tool")).toBe(true);
});
```

**`TestEnv` interface:**

```ts
interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  ok: boolean;
}

interface TestEnv {
  /** Absolute path of the temp root */
  root: string;
  exec(cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<ExecResult>;
  exists(relativePath: string): Promise<boolean>;
  read(relativePath: string): Promise<string>;
  write(relativePath: string, content: string): Promise<void>;
  cleanup(): Promise<void>;
}
```

`cwd` in `exec` is resolved relative to `env.root`. The `cape` binary on `PATH` is the locally built one — tests have a prerequisite that `cape build` has run.

**Doc verification:** Each step that produces output worth documenting is captured as a golden file in `tests/golden/<scenario>/<step>.txt`. On normal runs the output is compared against the golden file. Pass `--update-golden` to refresh them after intentional changes. When writing documentation, copy examples from golden files — they are guaranteed to be correct.

**When to run:** On every save during development. Should complete in seconds.

---

## Layer 2 — Distribution tests (container)

**Purpose:** Test the full distribution path — build, compress, install script, clean OS, binary works with no Bun in PATH. Catches the class of bugs that would embarrass a release.

**Isolation:** A Docker container with a minimal Linux base (e.g., `debian:slim`). No Bun, no Node, nothing pre-installed beyond `curl`/`wget` and `sh`. The only thing injected is the built `dist/` directory.

**Runner:** A small Bun script that manages container lifecycle and runs scenario steps.

**When to run:** In CI on push to main, and as part of the pre-publish checklist.

### Scenario structure

Each container scenario is a TypeScript file that defines named steps:

```ts
// tests/container/install.scenario.ts
import { defineScenario } from "../helpers/container.ts";

export default defineScenario({
  name: "install-from-release",
  image: "debian:slim",
  mounts: [{ host: "./dist", container: "/release" }],
  steps: [
    {
      name: "install-from-script",
      run: `sh /release/install.sh`,
    },
    {
      name: "binary-is-on-path",
      run: `export PATH="$HOME/.cape/bin:$PATH" && cape --version`,
      expect: { stdout: /cape \d+\.\d+\.\d+/ },
    },
    {
      name: "init-a-project",
      run: `export PATH="$HOME/.cape/bin:$PATH" && cape init my-tool --yes`,
      expect: { stdout: /Created my-tool/ },
    },
    {
      name: "run-hello-command",
      run: `cd my-tool && cape run hello -- --name World`,
      expect: { stdout: /Hello, World!/ },
    },
  ],
});
```

### Interactive debugging

When a step fails — or before it runs — you often want to inspect the container state directly. The test framework supports a `--debug` flag that pauses execution and hands you an interactive shell instead of continuing or tearing down.

```sh
# Run all steps, drop into shell if any step fails
bun test:container --debug

# Run steps up to and including "binary-is-on-path", then give a shell
bun test:container --debug-at binary-is-on-path

# Run only up to (not including) the named step, then give a shell
bun test:container --debug-before init-a-project
```

When debug mode activates, the framework:

1. Keeps the container running (skips the normal `docker rm`)
2. Prints the container ID and the state reached so far
3. Execs into the container with an interactive shell:
   ```
   ── Stopped before: init-a-project ──────────────────────────
   Container: cape-test-a3f2b1
   Steps completed: install-from-script, binary-is-on-path

   Dropping into container shell. Type `exit` to stop.
   ────────────────────────────────────────────────────────────
   root@cape-test-a3f2b1:/#
   ```
4. On shell exit, tears down the container and exits

This means you can reproduce exactly the environment at any point in the scenario, inspect files, run commands manually, and diagnose what went wrong — without guessing at environment state.

**Implementation sketch:**

```ts
async function runScenario(scenario: Scenario, opts: RunOpts) {
  const containerId = await docker.run(scenario.image, scenario.mounts);

  try {
    for (const step of scenario.steps) {
      if (opts.debugBefore === step.name) {
        await dropIntoShell(containerId, scenario, step, "before");
        return;
      }

      const result = await docker.exec(containerId, step.run);

      if (!passes(result, step.expect)) {
        if (opts.debug) {
          await dropIntoShell(containerId, scenario, step, "after-failure");
        }
        throw new StepFailure(step, result);
      }

      if (opts.debugAt === step.name) {
        await dropIntoShell(containerId, scenario, step, "after");
        return;
      }
    }
  } finally {
    if (!isShellActive()) {
      await docker.remove(containerId);
    }
  }
}

async function dropIntoShell(containerId, scenario, step, timing) {
  printDebugBanner(scenario, step, timing);
  await execa("docker", ["exec", "-it", containerId, "/bin/sh"], { stdio: "inherit" });
  await docker.remove(containerId);
}
```

---

## Summary

| | Layer 1 | Layer 2 |
|---|---|---|
| What it tests | Framework logic | Distribution path |
| Isolation | Temp dir + HOME override | Clean Linux container |
| Speed | Fast (seconds) | Slow (tens of seconds) |
| When to run | Every save | CI + pre-publish |
| Debugging | Standard Bun tooling | `--debug-at <step>` interactive shell |
| Doc verification | Golden files | Not applicable |

The two layers are complementary. Layer 1 gives rapid feedback on logic; Layer 2 gives confidence that the thing you ship actually works on a clean machine.
