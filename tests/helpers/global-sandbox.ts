import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SANDBOX_XDG = join(import.meta.dirname, ".test-xdg");
const SANDBOX_CACHE = join(import.meta.dirname, ".test-cache");

process.env.XDG_CONFIG_HOME = SANDBOX_XDG;
process.env.XDG_CACHE_HOME = SANDBOX_CACHE;

export const SANDBOX_GLOBAL_BASE = join(SANDBOX_XDG, "opencode");
export const SANDBOX_CACHE_PACKAGES = join(SANDBOX_CACHE, "opencode", "packages");

let lock: Promise<void> = Promise.resolve();

export function withGlobalSandbox<T>(operation: () => Promise<T>): Promise<T> {
  const run = lock.then(operation);
  lock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export async function resetGlobalConfig(): Promise<void> {
  await rm(SANDBOX_GLOBAL_BASE, { recursive: true, force: true });
}

export async function writeGlobalPluginConfig(plugin: string[]): Promise<void> {
  await mkdir(SANDBOX_GLOBAL_BASE, { recursive: true });
  await writeFile(
    join(SANDBOX_GLOBAL_BASE, "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin }, null, 2)
  );
}
