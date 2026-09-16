import { resolveHarnessExecutable } from "@codexhost/harness-discovery";

export function resolveKimiExecutable(environment: NodeJS.ProcessEnv, command?: string): string {
  const resolution = resolveHarnessExecutable(
    {
      id: "kimi-code",
      command: "kimi",
      commandEnvironmentVariable: "CODEXHOST_KIMI_CODE_COMMAND",
      installRoots: { posix: ["~/.kimi-code/bin"], windows: ["~/.kimi-code/bin"] },
    },
    { environment, ...(command ? { command } : {}) },
  );
  if (!resolution) throw new Error("Kimi Code executable not found");
  return resolution.executable;
}
