import {
  createInstallationManager,
  runInstallationCommand,
  versionFromOutput,
} from "@codexhost/harness-discovery";
import { resolveAntigravityExecutable } from "./command.js";

export function createAntigravityInstallation(environment: NodeJS.ProcessEnv, command?: string) {
  const run = (args: string[], timeout?: number) =>
    runInstallationCommand(
      resolveAntigravityExecutable({ environment, ...(command ? { command } : {}) }) ?? "agy",
      args,
      environment,
      timeout,
    );
  return createInstallationManager({
    async check() {
      const currentVersion = versionFromOutput(await run(["--version"]));
      return {
        currentVersion,
        latestVersion: currentVersion,
        updateAvailable: false,
        canUpdate: true,
      };
    },
    async update() {
      await run(["update"], 300_000);
    },
  });
}
