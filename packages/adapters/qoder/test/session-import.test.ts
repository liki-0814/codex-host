import { expect, it } from "vitest";
import { QoderAdapter } from "../src/qoder-adapter.js";
it("imports SDK-discovered sessions with original cwd and revalidates removed sessions", async () => {
  let sessions = [
    { sessionId: "native-session", summary: "History", cwd: "/original", lastModified: 123.75 },
  ];
  const adapter = new QoderAdapter({ listSessions: async () => sessions });
  expect(await adapter.sessionImport.listCandidates()).toMatchObject({
    ok: true,
    value: [
      {
        nativeSessionId: "native-session",
        cwd: "/original",
        title: "History",
        updatedAt: 123,
        running: null,
      },
    ],
  });
  sessions = [];
  expect(await adapter.sessionImport.resolveCandidate?.("native-session")).toMatchObject({
    ok: false,
  });
  await adapter.close();
});
