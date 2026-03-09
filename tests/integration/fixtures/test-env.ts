import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exists } from "node:fs/promises";

export interface TestEnv {
  projectDir: string;
  xdgConfigHome: string;
  cleanup: () => Promise<void>;
}

export interface CreateTestEnvOptions {
  withRootOpenencodeJson?: boolean;
  withRootOpenencodeJsonContent?: Record<string, unknown>;
  withDotOpenencode?: boolean;
  withDotOpenencodeJsonContent?: Record<string, unknown>;
  globalConfig?: Record<string, unknown>;
}

async function writeJsonFile(path: string, content: Record<string, unknown>): Promise<void> {
  await writeFile(path, JSON.stringify(content, null, 2));
}

export async function createTestEnv(options: CreateTestEnvOptions = {}): Promise<TestEnv> {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  const baseDir = join(tmpdir(), `intellisearch-test-${timestamp}-${randomSuffix}`);

  const projectDir = join(baseDir, "project");
  const xdgConfigHome = join(baseDir, "xdg-config");

  await mkdir(projectDir, { recursive: true });
  await mkdir(xdgConfigHome, { recursive: true });

  if (options.withRootOpenencodeJson) {
    const content = options.withRootOpenencodeJsonContent || { model: "test-model" };
    await writeJsonFile(join(projectDir, "opencode.json"), content);
  }

  if (options.withDotOpenencode) {
    const dotOpenencodeDir = join(projectDir, ".opencode");
    await mkdir(dotOpenencodeDir, { recursive: true });

    if (options.withDotOpenencodeJsonContent) {
      await writeJsonFile(join(dotOpenencodeDir, "opencode.json"), options.withDotOpenencodeJsonContent);
    }
  }

  if (options.globalConfig) {
    const opencodeDir = join(xdgConfigHome, "opencode");
    await mkdir(opencodeDir, { recursive: true });
    await writeJsonFile(join(opencodeDir, "opencode.json"), options.globalConfig);
  }

  return {
    projectDir,
    xdgConfigHome,
    cleanup: async () => {
      await rm(baseDir, { recursive: true, force: true });
    },
  };
}

export async function assertFileExists(path: string): Promise<boolean> {
  return exists(path);
}

export async function assertDirectoryExists(path: string): Promise<boolean> {
  try {
    const file = Bun.file(path);
    const stat = await file.exists();
    return stat;
  } catch {
    return false;
  }
}

export async function readJsonFile<T = Record<string, unknown>>(path: string): Promise<T | null> {
  try {
    const content = await Bun.file(path).text();
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export function getSkillPath(baseDir: string): string {
  return join(baseDir, ".opencode", "skills", "intellisearch");
}

export function getGlobalSkillPath(xdgConfigHome: string): string {
  return join(xdgConfigHome, "opencode", "skills", "intellisearch");
}

export function getCommandPath(baseDir: string): string {
  return join(baseDir, ".opencode", "commands", "search-intelligently.md");
}

export function getGlobalCommandPath(xdgConfigHome: string): string {
  return join(xdgConfigHome, "opencode", "commands", "search-intelligently.md");
}

export function getConfigPath(baseDir: string): string {
  return join(baseDir, ".opencode", "opencode.json");
}

export function getGlobalConfigPath(xdgConfigHome: string): string {
  return join(xdgConfigHome, "opencode", "opencode.json");
}

export function getVersionMarkerPath(baseDir: string): string {
  return join(baseDir, ".opencode", "skills", "intellisearch", ".version");
}

export function getGlobalVersionMarkerPath(xdgConfigHome: string): string {
  return join(xdgConfigHome, "opencode", "skills", "intellisearch", ".version");
}
