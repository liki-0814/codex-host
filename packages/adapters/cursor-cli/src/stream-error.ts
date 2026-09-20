/** Native Cursor ACP streams this internal teardown as assistant text, then reports end_turn. */

const CLOSED_ERROR =
  /(?:\n\n)?Error:\s*(?:(?:RetriableError|T):)?\s*WritableIterable is closed\s*$/u;

const CLOSED_PREFIXES = [
  "\n\nError: RetriableError: WritableIterable is closed",
  "\n\nError: T: WritableIterable is closed",
  "\n\nError: WritableIterable is closed",
  "Error: RetriableError: WritableIterable is closed",
  "Error: T: WritableIterable is closed",
  "Error: WritableIterable is closed",
];

export function isCursorWritableIterableClosed(message: string): boolean {
  return /WritableIterable is closed/iu.test(message);
}

export function takeCursorWritableIterableClosed(text: string): {
  visible: string;
  closed: boolean;
} {
  const match = text.match(CLOSED_ERROR);
  if (!match || match.index === undefined) return { visible: text, closed: false };
  return { visible: text.slice(0, match.index), closed: true };
}

export function holdCursorWritableIterablePrefix(text: string): { emit: string; hold: string } {
  const taken = takeCursorWritableIterableClosed(text);
  if (taken.closed) return { emit: taken.visible, hold: "" };
  for (let size = Math.min(text.length, longestClosedPrefix()); size > 0; size -= 1) {
    const suffix = text.slice(-size);
    if (CLOSED_PREFIXES.some((candidate) => candidate.startsWith(suffix))) {
      return { emit: text.slice(0, -size), hold: suffix };
    }
  }
  return { emit: text, hold: "" };
}

function longestClosedPrefix(): number {
  return CLOSED_PREFIXES.reduce((longest, prefix) => Math.max(longest, prefix.length), 0);
}
