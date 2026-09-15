import type { HostEvent, HostSubagentDelegationItem } from "@codexhost/harness-adapter";
import { hostItemIdSchema, type HostTurnId } from "@codexhost/shared-contracts";

/** Native hook identities are the same IDs consumed by getSubagentMessages. */
export class QoderSubagentObserver {
  readonly #active = new Map<string, { turnId: HostTurnId; item: HostSubagentDelegationItem }>();
  constructor(readonly emit: (event: HostEvent) => void) {}
  start(id: string, role: string, turnId: HostTurnId): void {
    if (this.#active.has(id)) return;
    const item: HostSubagentDelegationItem = {
      type: "subagentDelegation",
      itemId: hostItemIdSchema.parse(`qoder-subagent-${id}`),
      operation: "spawn",
      subagents: [
        {
          subagentId: id,
          nativeSubagentId: id,
          description: role,
          role,
          background: false,
          status: "running",
        },
      ],
    };
    this.#active.set(id, { turnId, item });
    this.emit({ type: "item.started", turnId, item });
  }
  stop(id: string): void {
    this.#finish(id, false);
  }
  endTurn(turnId: HostTurnId): void {
    for (const [id, entry] of this.#active) if (entry.turnId === turnId) this.#finish(id, true);
  }
  #finish(id: string, interrupted: boolean): void {
    const entry = this.#active.get(id);
    if (!entry) return;
    this.#active.delete(id);
    entry.item = {
      ...entry.item,
      subagents: entry.item.subagents.map((child) => ({
        ...child,
        status: interrupted ? "interrupted" : "completed",
      })),
    };
    this.emit({
      type: "item.updated",
      turnId: entry.turnId,
      itemId: entry.item.itemId,
      update: { type: "subagents.replace", subagents: entry.item.subagents },
    });
    this.emit({
      type: "item.completed",
      turnId: entry.turnId,
      snapshot: {
        item: entry.item,
        outcome: interrupted
          ? {
              status: "cancelled",
              reason: "Parent turn ended before child completion was observed",
            }
          : { status: "succeeded" },
      },
    });
  }
}
