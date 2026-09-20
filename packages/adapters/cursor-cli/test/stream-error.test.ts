import { describe, expect, it } from "vitest";
import type { HostEvent } from "@codexhost/harness-adapter";
import { hostTurnIdSchema } from "@codexhost/shared-contracts";
import { CursorTurnOutput } from "../src/projection.js";
import {
  holdCursorWritableIterablePrefix,
  isCursorWritableIterableClosed,
  takeCursorWritableIterableClosed,
} from "../src/stream-error.js";
import { cursorError } from "../src/adapter.js";

function output() {
  const events: HostEvent[] = [];
  return {
    events,
    turn: new CursorTurnOutput(hostTurnIdSchema.parse("turn"), (event) => events.push(event)),
  };
}

function message(text: string) {
  return {
    sessionId: "session",
    update: {
      sessionUpdate: "agent_message_chunk" as const,
      content: { type: "text" as const, text },
    },
  };
}

describe("Cursor WritableIterable stream error", () => {
  it("classifies the native teardown as retryable instead of process exit", () => {
    expect(isCursorWritableIterableClosed("Error: RetriableError: WritableIterable is closed")).toBe(
      true,
    );
    expect(cursorError(new Error("RetriableError: WritableIterable is closed"))).toEqual({
      code: "nativeFailure",
      message: "Cursor stream closed (WritableIterable)",
      retryable: true,
    });
  });

  it("splits a trailing closed suffix from a completed answer", () => {
    expect(
      takeCursorWritableIterableClosed("PONG\n\nError: RetriableError: WritableIterable is closed"),
    ).toEqual({ visible: "PONG", closed: true });
    expect(holdCursorWritableIterablePrefix("PONG\n\nErr")).toEqual({
      emit: "PONG",
      hold: "\n\nErr",
    });
  });

  it("does not project the trailing closed chunk after a real answer", () => {
    const f = output();
    f.turn.update(message("PONG"));
    f.turn.update(message("\n\nError: RetriableError: WritableIterable is closed"));
    f.turn.finish({ status: "succeeded" });
    expect(f.turn.sawWritableIterableClosed()).toBe(true);
    expect(f.turn.hasVisibleAssistantText()).toBe(false);
    const texts = f.events.flatMap((event) =>
      event.type === "item.updated" && event.update.type === "text.append"
        ? [event.update.text]
        : event.type === "item.completed" && event.snapshot.item.type === "agentMessage"
          ? [event.snapshot.item.text]
          : [],
    );
    expect(texts.join("")).toBe("PONGPONG");
    expect(texts.some((text) => text.includes("WritableIterable"))).toBe(false);
  });

  it("holds a split closed prefix until it completes", () => {
    const f = output();
    f.turn.update(message("\n\nError: Retriable"));
    expect(f.events).toEqual([]);
    f.turn.update(message("Error: WritableIterable is closed"));
    f.turn.finish({ status: "succeeded" });
    expect(f.turn.sawWritableIterableClosed()).toBe(true);
    expect(f.events.filter((event) => event.type === "item.started")).toEqual([]);
  });
});
