import type { Key } from "./types.ts";

/**
 * Parses a raw byte buffer into a Key event.
 * Returns `{ key, consumed }` indicating how many bytes were consumed,
 * or null if the buffer is empty or contains only an incomplete sequence.
 */
export function parseKey(buf: number[]): { key: Key; consumed: number } | null {
  if (buf.length === 0) return null;

  const b0 = buf[0]!;

  // Ctrl+C or Ctrl+D → interrupt
  if (b0 === 3 || b0 === 4) return { key: { type: "interrupt" }, consumed: 1 };

  // Enter (\r or \n)
  if (b0 === 13 || b0 === 10) return { key: { type: "enter" }, consumed: 1 };

  // Backspace (DEL or BS)
  if (b0 === 127 || b0 === 8) return { key: { type: "backspace" }, consumed: 1 };

  // Tab
  if (b0 === 9) return { key: { type: "tab" }, consumed: 1 };

  // Escape sequence
  if (b0 === 27) {
    // Just escape (no following bytes)
    if (buf.length === 1) return { key: { type: "escape" }, consumed: 1 };

    // CSI sequences: ESC [ ...
    if (buf[1] === 91) {
      if (buf.length < 3) return null; // incomplete, wait for more

      const b2 = buf[2]!;
      switch (b2) {
        case 65:
          return { key: { type: "up" }, consumed: 3 }; // ESC [ A
        case 66:
          return { key: { type: "down" }, consumed: 3 }; // ESC [ B
        case 67:
          return { key: { type: "right" }, consumed: 3 }; // ESC [ C
        case 68:
          return { key: { type: "left" }, consumed: 3 }; // ESC [ D
        case 72:
          return { key: { type: "home" }, consumed: 3 }; // ESC [ H
        case 70:
          return { key: { type: "end" }, consumed: 3 }; // ESC [ F
        case 51: // ESC [ 3 ~ → delete
          if (buf.length < 4) return null;
          if (buf[3] === 126) return { key: { type: "delete" }, consumed: 4 };
          break;
        case 49: // ESC [ 1 ~ → home (alt)
          if (buf.length < 4) return null;
          if (buf[3] === 126) return { key: { type: "home" }, consumed: 4 };
          break;
        case 52: // ESC [ 4 ~ → end (alt)
          if (buf.length < 4) return null;
          if (buf[3] === 126) return { key: { type: "end" }, consumed: 4 };
          break;
      }
      // Unknown CSI sequence — consume the three bytes
      return { key: { type: "escape" }, consumed: 3 };
    }

    // ESC O sequences (SS3): arrows on some terminals
    if (buf[1] === 79) {
      if (buf.length < 3) return null;
      const b2 = buf[2]!;
      switch (b2) {
        case 65:
          return { key: { type: "up" }, consumed: 3 };
        case 66:
          return { key: { type: "down" }, consumed: 3 };
        case 67:
          return { key: { type: "right" }, consumed: 3 };
        case 68:
          return { key: { type: "left" }, consumed: 3 };
        case 72:
          return { key: { type: "home" }, consumed: 3 };
        case 70:
          return { key: { type: "end" }, consumed: 3 };
      }
    }

    // Lone ESC
    return { key: { type: "escape" }, consumed: 1 };
  }

  // Printable ASCII
  if (b0 >= 32 && b0 <= 126) {
    return { key: { type: "char", char: String.fromCharCode(b0) }, consumed: 1 };
  }

  // Unknown — skip one byte
  return { key: { type: "escape" }, consumed: 1 };
}

/**
 * Parses all key events from a raw byte chunk (as received from stdin in raw
 * mode). Returns zero or more key events.
 */
export function parseKeys(chunk: Uint8Array | Buffer): Key[] {
  const buf = Array.from(chunk);
  const keys: Key[] = [];
  let offset = 0;

  while (offset < buf.length) {
    const result = parseKey(buf.slice(offset));
    if (!result) {
      offset++;
      continue;
    }
    keys.push(result.key);
    offset += result.consumed;
  }

  return keys;
}

/**
 * Attaches a raw-mode key listener to stdin. Returns a `next()` function
 * that resolves with the next key event, and a `cleanup()` function to
 * remove the listener.
 *
 * The caller is responsible for setting raw mode and calling cleanup().
 */
export function makeKeyReader(): { next: () => Promise<Key>; cleanup: () => void } {
  const queue: Key[] = [];
  let waiting: ((key: Key) => void) | undefined;

  const handler = (chunk: Buffer) => {
    for (const key of parseKeys(chunk)) {
      if (waiting) {
        const resolve = waiting;
        waiting = undefined;
        resolve(key);
      } else {
        queue.push(key);
      }
    }
  };

  process.stdin.on("data", handler);

  return {
    next: () =>
      new Promise<Key>((resolve) => {
        if (queue.length > 0) {
          resolve(queue.shift()!);
        } else {
          waiting = resolve;
        }
      }),
    cleanup: () => {
      process.stdin.removeListener("data", handler);
      waiting = undefined;
    },
  };
}
