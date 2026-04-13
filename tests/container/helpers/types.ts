export interface StepExpect {
  stdout?: RegExp | string;
  stderr?: RegExp | string;
  exitCode?: number;
}

export interface Step {
  name: string;
  /** Shell command string — passed as a single argument to `sh -c` */
  run: string;
  expect?: StepExpect;
}

export interface Mount {
  /** Path on the host — relative to repo root or absolute */
  host: string;
  /** Absolute path inside the container */
  container: string;
}

export interface Scenario {
  name: string;
  image: string;
  /** Optional platform override, e.g. "linux/arm64". Passed to `docker run --platform`. */
  platform?: string;
  mounts?: Mount[];
  steps: Step[];
}

export interface RunOpts {
  /** Drop into interactive shell on any step failure */
  debug?: boolean;
  /** Drop into interactive shell after this step completes */
  debugAt?: string;
  /** Drop into interactive shell before this step runs */
  debugBefore?: string;
}

export interface StepResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  ok: boolean;
}

export type DebugTiming = "before" | "after" | "after-failure";
