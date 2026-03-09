import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile, rm, symlink, cp, exists } from "node:fs/promises";

function getGlobalCachePath(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig) {
    return join(xdgConfig, "..", ".cache", "opencode", "node_modules", "opencode-intellisearch");
  }
  return join(homedir(), ".cache", "opencode", "node_modules", "opencode-intellisearch");
}

async function cleanupStaleGlobalInstall(): Promise<void> {
  const globalPath = getGlobalCachePath();
  try {
    if (await exists(globalPath)) {
      await rm(globalPath, { recursive: true, force: true });
    }
  } catch {}
}

export interface TestProjectContext {
  directory: string;
  cleanup: () => Promise<void>;
}

export async function setupTestProject(
  pluginPath: string,
  queryFileDir: string,
  model: string | null
): Promise<TestProjectContext> {
  await cleanupStaleGlobalInstall();
  
  const timestamp = Date.now();
  const projectDir = join(tmpdir(), `opencode-e2e-${timestamp}`);
  
  await mkdir(join(projectDir, ".opencode"), { recursive: true });
  
  const config: Record<string, unknown> = {
    "$schema": "https://opencode.ai/config.json",
    "plugin": [`file:///${pluginPath.replace(/\\/g, "/")}`]
  };
  
  if (model) {
    config["model"] = model;
  }
  
  await writeFile(
    join(projectDir, ".opencode", "opencode.json"),
    JSON.stringify(config, null, 2)
  );
  
  const targetQueriesDir = join(projectDir, "test-queries");
  const sourceQueriesDir = queryFileDir;
  
  try {
    await symlink(sourceQueriesDir, targetQueriesDir, "junction");
  } catch {
    await cp(sourceQueriesDir, targetQueriesDir, { recursive: true });
  }
  
  let cleanedUp = false;
  
  async function cleanup(): Promise<void> {
    if (cleanedUp) return;
    cleanedUp = true;
    
    try {
      await rm(projectDir, { recursive: true, force: true });
    } catch {}
  }
  
  const cleanupHandler = (): void => {
    cleanup().catch(() => {});
  };
  
  process.on("exit", cleanupHandler);
  process.on("SIGINT", cleanupHandler);
  process.on("SIGTERM", cleanupHandler);
  
  return {
    directory: projectDir,
    cleanup,
  };
}
