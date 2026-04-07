import { NonTtyError } from "../prompt/types.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface StdinInterface {
  /** True when stdin is connected to a terminal. */
  readonly isTTY: boolean;
  /**
   * Read all of stdin and return it as a string.
   * On a TTY this reads until the user presses Ctrl+D.
   */
  read(): Promise<string>;
  /**
   * Async iterable of lines from stdin.
   * Each value is a line without the trailing newline.
   */
  lines(): AsyncIterable<string>;
}

// ---------------------------------------------------------------------------
// Real implementation
// ---------------------------------------------------------------------------

export function createStdin(): StdinInterface {
  const isTTY = !!process.stdin.isTTY;

  async function read(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  async function* lines(): AsyncIterable<string> {
    let buffer = "";
    for await (const chunk of process.stdin) {
      buffer += (chunk as Buffer).toString("utf8");
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) yield line;
    }
    if (buffer) yield buffer;
  }

  return { isTTY, read, lines };
}

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------

/** Mock StdinInterface that reads from a pre-set string. */
export function createMockStdin(content = "", isTTY = false): StdinInterface {
  return {
    isTTY,
    async read() {
      return content;
    },
    async *lines() {
      for (const line of content.split("\n")) {
        if (line || content.endsWith("\n")) yield line;
      }
    },
  };
}
