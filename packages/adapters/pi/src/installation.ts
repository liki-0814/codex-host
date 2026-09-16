import {
  createInstallationManager,
  newerInstallationVersion,
  npmInstallation,
} from "@codexhost/harness-discovery";
import { resolvePiExecutable } from "./command.js";

export function createPiInstallation(environment: NodeJS.ProcessEnv, command?: string) {
  const resolve = () => resolvePiExecutable({ environment, ...(command ? { command } : {}) });
  const installation = async () => {
    const result = await npmInstallation(
      resolve(),
      ["@earendil-works/pi-coding-agent", "@mariozechner/pi-coding-agent"],
      environment,
    );
    if (!result) throw new Error("Pi is not an npm installation; use its original installer");
    return result;
  };
  return createInstallationManager({
    async check() {
      const local = await installation();
      const latestVersion = await local.latest();
      return {
        currentVersion: local.currentVersion,
        latestVersion,
        canUpdate: local.canUpdate,
        updateAvailable: newerInstallationVersion(local.currentVersion, latestVersion),
        ...(!local.canUpdate ? { message: "Use the original package manager to update Pi" } : {}),
      };
    },
    async update(state) {
      await (await installation()).update(state.latestVersion);
    },
  });
}
