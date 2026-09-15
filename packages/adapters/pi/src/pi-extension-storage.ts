import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function piExtensionPath(
  name: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(
    environment.HOME ?? environment.USERPROFILE ?? homedir(),
    ".codexhost",
    "extensions",
    name,
    "index.mjs",
  );
}
export function verifiedPiExtension(file: string, source: string): string | undefined {
  try {
    return readFileSync(file, "utf8") === source ? file : undefined;
  } catch {
    return undefined;
  }
}
export async function installPiExtension(file: string, source: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, source, { mode: 0o600 });
  if ((await readFile(file, "utf8")) !== source)
    throw new Error("Extension installation could not be verified");
}

export function piExtensionState(
  file: string,
  source: string,
): { installed: boolean; updateAvailable?: boolean } {
  try {
    const installed = readFileSync(file, "utf8");
    return { installed: true, ...(installed !== source ? { updateAvailable: true } : {}) };
  } catch {
    return { installed: false };
  }
}
