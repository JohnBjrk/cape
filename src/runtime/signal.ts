// ---------------------------------------------------------------------------
// Signal management
// ---------------------------------------------------------------------------

export type ExitHandler = () => void | Promise<void>;

export interface SignalManager {
  /** AbortSignal that is aborted when SIGINT or SIGTERM is received. */
  signal: AbortSignal;
  /** Register a cleanup function to run on signal or process exit. */
  onExit(fn: ExitHandler): void;
  /** Tear down signal listeners (call after the command finishes). */
  teardown(): void;
}

export function createSignalManager(): SignalManager {
  const controller = new AbortController();
  const handlers: ExitHandler[] = [];

  async function runHandlers() {
    // Run in reverse registration order (LIFO)
    for (const fn of [...handlers].reverse()) {
      try {
        await fn();
      } catch {
        /* swallow cleanup errors */
      }
    }
  }

  const onSIGINT = () => {
    controller.abort();
    void runHandlers();
  };
  const onSIGTERM = () => {
    controller.abort();
    void runHandlers();
  };

  process.on("SIGINT", onSIGINT);
  process.on("SIGTERM", onSIGTERM);

  return {
    signal: controller.signal,
    onExit(fn) {
      handlers.push(fn);
    },
    teardown() {
      process.off("SIGINT", onSIGINT);
      process.off("SIGTERM", onSIGTERM);
    },
  };
}

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------

/** Mock SignalManager for use in tests. Exposes an abort() for triggering. */
export function createMockSignalManager(): SignalManager & {
  abort(): void;
  exitHandlers: ExitHandler[];
} {
  const controller = new AbortController();
  const exitHandlers: ExitHandler[] = [];

  return {
    signal: controller.signal,
    exitHandlers,
    onExit(fn) {
      exitHandlers.push(fn);
    },
    teardown() {},
    abort() {
      controller.abort();
    },
  };
}
