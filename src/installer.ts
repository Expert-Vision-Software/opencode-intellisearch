import { exists, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type Scope = "local" | "global";

export interface InstallResult {
  scope: Scope;
  skillPath: string;
  commandPath: string;
  configPath: string;
  migrated: boolean;
}

export interface UninstallResult {
  scope: Scope;
  removed: string[];
}

export interface StatusResult {
  local: { installed: boolean; version: string | null } | null;
  global: { installed: boolean; version: string | null } | null;
}

const SKILL_NAME = "intellisearch";
const COMMAND_NAME = "search-intelligently.md";

export async function getPackageVersion(): Promise<string> {
  const content = await Bun.file(`${import.meta.dirname}/../package.json`).text();
  return JSON.parse(content).version;
}

function getPackageDir(): string {
  return join(import.meta.dirname, "..");
}

export function getGlobalConfigPath(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig) {
    return join(xdgConfig, "opencode");
  }
  return join(homedir(), ".config", "opencode");
}

export function getLocalConfigPath(projectDir: string): string {
  return join(projectDir, ".opencode");
}

async function copyDir(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else {
      await Bun.write(d, Bun.file(s));
    }
  }
}

async function readJsonConfig(path: string): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function writeJsonConfig(path: string, config: Record<string, unknown>): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2));
}

async function ensureSkillPermission(configPath: string): Promise<void> {
  const config = await readJsonConfig(configPath);
  
  if (!config.permission) {
    config.permission = {};
  }
  if (!(config.permission as Record<string, unknown>).skill) {
    (config.permission as Record<string, unknown>).skill = {};
  }
  
  const skillPerms = (config.permission as Record<string, unknown>).skill as Record<string, unknown>;
  if (skillPerms[SKILL_NAME] !== "allow") {
    skillPerms[SKILL_NAME] = "allow";
    await mkdir(join(configPath, ".."), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2));
  }
}

async function removeSkillPermission(configPath: string): Promise<void> {
  const config = await readJsonConfig(configPath);
  
  if (config.permission && (config.permission as Record<string, unknown>).skill) {
    const skillPerms = (config.permission as Record<string, unknown>).skill as Record<string, unknown>;
    delete skillPerms[SKILL_NAME];
    
    if (Object.keys(skillPerms).length === 0) {
      delete (config.permission as Record<string, unknown>).skill;
    }
    if (Object.keys(config.permission as Record<string, unknown>).length === 0) {
      delete config.permission;
    }
    
    await mkdir(join(configPath, ".."), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2));
  }
}

export async function checkMigrationNeeded(projectDir: string): Promise<{
  needed: boolean;
  rootConfigPath: string;
  dotOpenencodeConfigPath: string;
  rootConfig: Record<string, unknown> | null;
  dotOpenencodeConfig: Record<string, unknown> | null;
}> {
  const rootConfigPath = join(projectDir, "opencode.json");
  const dotOpenencodeConfigPath = join(projectDir, ".opencode", "opencode.json");
  
  const rootExists = await exists(rootConfigPath);
  const dotOpenencodeExists = await exists(dotOpenencodeConfigPath);
  
  if (!rootExists) {
    return {
      needed: false,
      rootConfigPath,
      dotOpenencodeConfigPath,
      rootConfig: null,
      dotOpenencodeConfig: null,
    };
  }
  
  const rootConfig = await readJsonConfig(rootConfigPath);
  const dotOpenencodeConfig = dotOpenencodeExists ? await readJsonConfig(dotOpenencodeConfigPath) : null;
  
  return {
    needed: rootExists,
    rootConfigPath,
    dotOpenencodeConfigPath,
    rootConfig,
    dotOpenencodeConfig,
  };
}

export async function migrateRootConfig(
  projectDir: string,
  onConflict?: (root: Record<string, unknown>, dot: Record<string, unknown>) => Promise<boolean>
): Promise<boolean> {
  const { needed, rootConfigPath, dotOpenencodeConfigPath, rootConfig, dotOpenencodeConfig } = 
    await checkMigrationNeeded(projectDir);
  
  if (!needed || !rootConfig) {
    return false;
  }
  
  if (dotOpenencodeConfig) {
    const hasConflict = Object.keys(rootConfig).some(key => key in dotOpenencodeConfig);
    if (hasConflict && onConflict) {
      const shouldContinue = await onConflict(rootConfig, dotOpenencodeConfig);
      if (!shouldContinue) {
        return false;
      }
    }
    
    const merged = { ...rootConfig, ...dotOpenencodeConfig };
    await writeJsonConfig(dotOpenencodeConfigPath, merged);
  } else {
    await mkdir(join(projectDir, ".opencode"), { recursive: true });
    await writeJsonConfig(dotOpenencodeConfigPath, rootConfig);
  }
  
  await rm(rootConfigPath);
  return true;
}

export async function install(
  scope: Scope,
  projectDir: string = process.cwd()
): Promise<InstallResult> {
  const version = await getPackageVersion();
  const pkgDir = getPackageDir();
  
  const configBase = scope === "global" 
    ? getGlobalConfigPath() 
    : getLocalConfigPath(projectDir);
  
  const skillPath = join(configBase, "skills", SKILL_NAME);
  const commandPath = join(configBase, "commands", COMMAND_NAME);
  const configPath = join(configBase, "opencode.json");
  const versionMarker = join(skillPath, ".version");
  
  let migrated = false;
  
  if (scope === "local") {
    migrated = await migrateRootConfig(projectDir);
  }
  
  await copyDir(
    join(pkgDir, "assets", "skills", SKILL_NAME),
    skillPath
  );
  
  await mkdir(join(configBase, "commands"), { recursive: true });
  await Bun.write(commandPath, Bun.file(join(pkgDir, "assets", "commands", COMMAND_NAME)));
  
  await Bun.write(versionMarker, version);
  await ensureSkillPermission(configPath);
  
  return {
    scope,
    skillPath,
    commandPath,
    configPath,
    migrated,
  };
}

export async function uninstall(
  scope: Scope,
  projectDir: string = process.cwd()
): Promise<UninstallResult> {
  const configBase = scope === "global" 
    ? getGlobalConfigPath() 
    : getLocalConfigPath(projectDir);
  
  const skillPath = join(configBase, "skills", SKILL_NAME);
  const commandPath = join(configBase, "commands", COMMAND_NAME);
  const configPath = join(configBase, "opencode.json");
  
  const removed: string[] = [];
  
  if (await exists(skillPath)) {
    await rm(skillPath, { recursive: true });
    removed.push(skillPath);
  }
  
  if (await exists(commandPath)) {
    await rm(commandPath);
    removed.push(commandPath);
  }
  
  if (await exists(configPath)) {
    await removeSkillPermission(configPath);
  }
  
  const skillsDir = join(configBase, "skills");
  const commandsDir = join(configBase, "commands");
  
  try {
    const skillsContents = await readdir(skillsDir);
    if (skillsContents.length === 0) {
      await rm(skillsDir, { recursive: true });
    }
  } catch {
    // Directory doesn't exist
  }
  
  try {
    const commandsContents = await readdir(commandsDir);
    if (commandsContents.length === 0) {
      await rm(commandsDir, { recursive: true });
    }
  } catch {
    // Directory doesn't exist
  }
  
  return { scope, removed };
}

export async function status(projectDir: string = process.cwd()): Promise<StatusResult> {
  const version = await getPackageVersion();
  
  const localConfigPath = getLocalConfigPath(projectDir);
  const localVersionMarker = join(localConfigPath, "skills", SKILL_NAME, ".version");
  
  const globalConfigPath = getGlobalConfigPath();
  const globalVersionMarker = join(globalConfigPath, "skills", SKILL_NAME, ".version");
  
  let localStatus: { installed: boolean; version: string | null } | null = null;
  let globalStatus: { installed: boolean; version: string | null } | null = null;
  
  try {
    const localVersion = (await readFile(localVersionMarker, "utf-8")).trim();
    localStatus = { installed: true, version: localVersion };
  } catch {
    const skillPath = join(localConfigPath, "skills", SKILL_NAME);
    if (await exists(skillPath)) {
      localStatus = { installed: true, version: null };
    }
  }
  
  try {
    const globalVersion = (await readFile(globalVersionMarker, "utf-8")).trim();
    globalStatus = { installed: true, version: globalVersion };
  } catch {
    const skillPath = join(globalConfigPath, "skills", SKILL_NAME);
    if (await exists(skillPath)) {
      globalStatus = { installed: true, version: null };
    }
  }
  
  return {
    local: localStatus,
    global: globalStatus,
  };
}
