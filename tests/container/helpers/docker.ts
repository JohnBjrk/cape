import { join } from "node:path";
import type { Mount, StepResult } from "./types.ts";

/**
 * Pull a Docker image, streaming progress to stdout.
 */
export async function pullImage(image: string): Promise<void> {
  const proc = Bun.spawnSync(["docker", "pull", image], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if (proc.exitCode !== 0) {
    throw new Error(`docker pull ${image} failed (exit ${proc.exitCode})`);
  }
}

/**
 * Start a long-lived container and return its ID.
 * The container runs `tail -f /dev/null` to stay alive.
 * Cleanup is managed manually — do NOT use --rm.
 */
export async function startContainer(
  image: string,
  mounts: Mount[],
  repoRoot: string,
): Promise<string> {
  const volumeArgs = mounts.flatMap(({ host, container }) => [
    "-v",
    `${join(repoRoot, host)}:${container}`,
  ]);

  const proc = Bun.spawnSync(
    ["docker", "run", "-d", ...volumeArgs, image, "tail", "-f", "/dev/null"],
    { stdout: "pipe", stderr: "pipe" },
  );

  if (proc.exitCode !== 0) {
    const err = new TextDecoder().decode(proc.stderr);
    throw new Error(`docker run failed (exit ${proc.exitCode}): ${err}`);
  }

  const id = new TextDecoder().decode(proc.stdout).trim();
  if (!id) throw new Error("docker run returned no container ID");
  return id;
}

/**
 * Run a shell command inside a running container.
 * The command string is passed as a single argument to `sh -c`.
 */
export function execInContainer(containerId: string, command: string): StepResult {
  const proc = Bun.spawnSync(["docker", "exec", containerId, "sh", "-c", command], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = new TextDecoder().decode(proc.stdout);
  const stderr = new TextDecoder().decode(proc.stderr);
  const exitCode = proc.exitCode ?? 1;

  return { stdout, stderr, exitCode, ok: exitCode === 0 };
}

/**
 * Drop into an interactive shell inside the container.
 * Uses Bun.spawn (async) so that stdin/stdout/stderr are inherited
 * and the TTY is passed through correctly.
 * Must NOT use Bun.spawnSync — it would deadlock waiting for output
 * while also waiting for user input.
 */
export async function interactiveShell(containerId: string): Promise<void> {
  // Detect whether we're actually in a TTY — `-t` on docker exec fails in CI
  const ttyArgs = process.stdin.isTTY ? ["-it"] : ["-i"];
  const proc = Bun.spawn(["docker", "exec", ...ttyArgs, containerId, "/bin/sh"], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
}

/**
 * Force-remove a container, swallowing output.
 */
export async function removeContainer(containerId: string): Promise<void> {
  Bun.spawnSync(["docker", "rm", "-f", containerId], {
    stdout: "pipe",
    stderr: "pipe",
  });
}

/** Returns a short display name for a container ID (first 12 chars). */
export function shortId(containerId: string): string {
  return containerId.slice(0, 12);
}
