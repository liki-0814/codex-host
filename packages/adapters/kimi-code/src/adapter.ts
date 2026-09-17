import { deriveSession, readTurns } from "./history.js";
import { readUsage } from "./usage.js";
import { resolve } from "node:path";
import { z } from "zod";
import {
  nativeSessionImport,
  type HarnessAdapter,
  type HarnessSession,
  type HarnessResult,
  type OpenSessionInput,
} from "@codexhost/harness-adapter";
import type { HarnessInspection } from "@codexhost/shared-contracts";
import { fetchKimiAccount } from "./account-identity.js";
import { KimiServer, KimiError, kimiError, type KimiServerOptions } from "./server.js";
import {
  kimiId,
  modelCatalog,
  nativeModelsSchema,
  permissionProfile,
  permissions,
  selection,
} from "./models.js";
import { sessionSchema, statusSchema, projectTurn } from "./projection.js";
import { KimiSession, capabilities, commandCatalog } from "./session.js";

export class KimiCodeAdapter implements HarnessAdapter {
  readonly harnessId = kimiId;
  readonly commandCatalog = commandCatalog;
  readonly #sessions = new Set<KimiSession>();
  #metadata: Promise<KimiServer> | undefined;
  #inspection: Promise<HarnessInspection> | undefined;
  #closed = false;
  constructor(readonly options: KimiServerOptions = {}) {}
  readonly subagents: NonNullable<HarnessAdapter["subagents"]> = {
    readSnapshot: async ({ parent, nativeSubagentId }) => {
      try {
        if (parent.harnessId !== kimiId || !/^[A-Za-z0-9._-]+$/u.test(nativeSubagentId))
          throw new KimiError("invalidRequest", "Invalid Kimi child identity");
        const server =
          [...this.#sessions].find((s) => s.id === parent.nativeSessionId)?.server ??
          (await this.metadata());
        return {
          ok: true,
          value: {
            turns: (await readTurns(server, parent.nativeSessionId, nativeSubagentId)).map((t) =>
              projectTurn(parent.nativeSessionId, t),
            ),
          },
        };
      } catch (error) {
        return { ok: false, error: kimiError(error) };
      }
    },
  };
  async metadata(): Promise<KimiServer> {
    if (this.#closed) throw new KimiError("invalidState", "Kimi Adapter is closed");
    this.#metadata ??= (async () => {
      const server = new KimiServer(this.options);
      await server.start();
      return server;
    })().catch((error: unknown) => {
      this.#metadata = undefined;
      throw error;
    });
    return this.#metadata;
  }
  inspect(input: { refresh?: boolean } = {}): Promise<HarnessInspection> {
    if (input.refresh) this.#inspection = undefined;
    return (this.#inspection ??= this.inspectNative().then((result) => {
      if (result.status !== "ready") this.#inspection = undefined;
      return result;
    }));
  }
  async inspectNative(): Promise<HarnessInspection> {
    try {
      const server = await this.metadata();
      const [models, config] = await Promise.all([
        server.request("/models", nativeModelsSchema),
        server.request("/config", z.object({ default_model: z.string() })),
      ]);
      return {
        status: "ready",
        catalog: modelCatalog(models.items, config.default_model),
        capabilities,
        permissionModes: permissions,
      };
    } catch (error) {
      const normalized = kimiError(error);
      return {
        status: normalized.code === "notInstalled" ? "notInstalled" : "error",
        error: normalized,
      };
    }
  }
  readonly sessionImport = nativeSessionImport(
    kimiId,
    async (signal) => {
      const server = await this.metadata();
      const candidates: unknown[] = [];
      let before = "";
      const seen = new Set<string>();
      for (;;) {
        signal.throwIfAborted();
        const page = await server.request(
          `/sessions?page_size=100${before ? `&before_id=${encodeURIComponent(before)}` : ""}`,
          z.object({ items: z.array(sessionSchema), has_more: z.boolean() }),
        );
        for (const s of page.items)
          if (!s.archived)
            candidates.push({
              nativeSessionId: s.id,
              cwd: s.metadata.cwd,
              title: s.title || null,
              updatedAt: Date.parse(s.updated_at),
              running: null,
            });
        if (!page.has_more) return candidates;
        const next = page.items.at(-1)?.id;
        if (!next || seen.has(next))
          throw new KimiError("protocolError", "Kimi Session pagination did not advance");
        before = next;
        seen.add(next);
      }
    },
    () => this.#closed,
  );
  async open(input: OpenSessionInput): Promise<HarnessResult<HarnessSession>> {
    if (this.#closed)
      return {
        ok: false,
        error: kimiError(new KimiError("invalidState", "Kimi Adapter is closed")),
      };
    const server = new KimiServer({
      ...this.options,
      cwd: input.cwd,
      environment: { ...(this.options.environment ?? process.env), ...input.environment },
    });
    try {
      await server.start();
      const models = await server.request("/models", nativeModelsSchema);
      if (input.kind === "resume" && input.nativeRef.harnessId !== kimiId)
        throw new KimiError("invalidRequest", "Cannot resume another Harness's Session");
      if (input.kind === "fork" || input.kind === "rollbackLastTurn") {
        const source = await server.request(
          `/sessions/${encodeURIComponent(input.sourceRef.nativeSessionId)}`,
          sessionSchema,
        );
        if (resolve(source.metadata.cwd) !== resolve(input.cwd))
          throw new KimiError(
            "unsupported",
            "Kimi cannot derive history across working directories",
          );
      }
      const native =
        input.kind === "create"
          ? await server.request("/sessions", sessionSchema, { metadata: { cwd: input.cwd } })
          : input.kind === "resume"
            ? await server.request(
                `/sessions/${encodeURIComponent(input.nativeRef.nativeSessionId)}`,
                sessionSchema,
              )
            : await deriveSession(server, input);
      if (input.kind === "resume" && native.id !== input.nativeRef.nativeSessionId)
        throw new KimiError("protocolError", "Kimi Session identity changed");
      if (resolve(native.metadata.cwd) !== resolve(input.cwd))
        throw new KimiError("unsupported", "Kimi Session belongs to a different working directory");
      if ([...this.#sessions].some((s) => s.id === native.id))
        throw new KimiError("sessionBusy", "Kimi Session is already open");
      const path = `/sessions/${encodeURIComponent(native.id)}`;
      if (input.kind === "create") {
        const config = await server.request("/config", z.object({ default_model: z.string() }));
        const selected = input.model
          ? selection(input.model, models.items)
          : { model: config.default_model };
        const permission =
          input.permissionModeId ??
          (input.executionPolicy === "unattended-full-access" ? "agent.auto" : "agent.manual");
        await server.request(`${path}/profile`, z.unknown(), {
          agent_config: {
            ...selected,
            ...(input.thinkingOptionId ? { thinking: input.thinkingOptionId } : {}),
            ...permissionProfile(permission),
          },
        });
      }
      const status = await server.request(`${path}/status`, statusSchema);
      if (status.busy) throw new KimiError("sessionBusy", "Kimi Session has an active turn");
      const session = new KimiSession(
        server,
        native.id,
        models.items,
        status,
        () => this.#sessions.delete(session),
        await readUsage(server, path, status),
      );
      await session.start();
      this.#sessions.add(session);
      return { ok: true, value: session };
    } catch (error) {
      await server.close();
      return { ok: false, error: kimiError(error) };
    }
  }
  async inspectAccount() {
    if (this.#closed) return null;
    return fetchKimiAccount({
      ...(this.options.environment ? { environment: this.options.environment } : {}),
    });
  }
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.sessionImport.close();
    await Promise.allSettled([...this.#sessions].map((s) => s.close()));
    await this.#metadata?.then(
      (s) => s.close(),
      () => undefined,
    );
  }
}
