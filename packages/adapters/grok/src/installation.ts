import {
  createInstallationManager,
  installationVersion,
  runInstallationCommand,
} from "@codexhost/harness-discovery";
import { resolveGrokExecutable } from "./command.js";

export function createGrokInstallation(environment: NodeJS.ProcessEnv, command?: string) {
  const run = (args: string[], timeout?: number) =>
    runInstallationCommand(
      resolveGrokExecutable({ environment, ...(command ? { command } : {}) }),
      args,
      environment,
      timeout,
    );
  return createInstallationManager({
    async check() {
      const state = JSON.parse(await run(["update", "--check", "--json"])) as Record<
        string,
        unknown
      >;
      if (state.error || typeof state.updateAvailable !== "boolean")
        throw new Error("Grok update check failed");
      return {
        currentVersion: installationVersion(state.currentVersion),
        latestVersion: installationVersion(state.latestVersion),
        updateAvailable: state.updateAvailable,
        canUpdate: true,
      };
    },
    async update() {
      await run(["update"], 300_000);
    },
  });
}
