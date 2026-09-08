import { copyFile, exists, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { PluginNameNormalizer } from "./plugin-name.ts";
import { InstallManifest, type ManifestFileEntry } from "./manifest.ts";

export type Scope = "local" | "global";

export interface InstallOptions {
  addPluginConfig: boolean;
  migrateRootConfig: boolean;
  force: boolean;
  configurePermission?: boolean;
  configureMcp?: boolean;
}

export type RootConfigConflictHandler = (
  root: Record<string, unknown>,
  dot: Record<string, unknown>
) => Promise<boolean>;

export type InstallAction = "installed" | "upgraded" | "noop";

export interface InstallResult {
  action: InstallAction;
  scope: Scope;
  skillPaths: string[];
  commandPaths: string[];
  configPath: string;
  manifestPath: string;
  skipped: string[];
  migrated: boolean;
  pluginAdded: boolean;
  permissionConfigured: boolean;
  mcpConfigured: boolean;
  recommendations: string[];
}

export interface UninstallResult {
  scope: Scope;
  removed: string[];
  pluginRemoved: boolean;
}

const MCP_SERVER_NAME = "deepwiki";
const MCP_SERVER_URL = "https://mcp.deepwiki.com/mcp";

export interface ScopeStatus {
  installed: boolean;
  version: string | null;
  pluginInConfig: boolean;
}

export interface StatusResult {
  local: ScopeStatus | null;
  global: ScopeStatus | null;
}

export async function getPackageVersion(): Promise<string> {
  const content = await Bun.file(`${import.meta.dirname}/../package.json`).text();
  return JSON.parse(content).version;
}

export async function getPackageName(): Promise<string> {
  const content = await Bun.file(`${import.meta.dirname}/../package.json`).text();
  return JSON.parse(content).name;
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

function getPackageDir(): string {
  return join(import.meta.dirname, "..");
}

async function resolvePackageDir(): Promise<string> {
  const packageDir = getPackageDir();
  const assetsSkillsPath = join(packageDir, "assets", "skills");
  if (!(await exists(assetsSkillsPath))) {
    throw new Error(
      `Package assets not found at ${assetsSkillsPath}. ` +
        `Installs must run from the published package (e.g. "bunx ${await getPackageName()}@latest install" ` +
        `or a global install), never from a partial cache artifact.`
    );
  }
  return packageDir;
}

function isFileNotFoundError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

interface PlannedAssetFile {
  sourcePath: string;
  relativeDest: string;
}

async function collectAssetFiles(packageDir: string): Promise<PlannedAssetFile[]> {
  const planned: PlannedAssetFile[] = [];
  planned.push(...(await collectSkillFiles(join(packageDir, "assets", "skills"))));
  planned.push(...(await collectCommandFiles(join(packageDir, "assets", "commands"))));
  return planned;
}

async function collectSkillFiles(assetsRoot: string): Promise<PlannedAssetFile[]> {
  const planned: PlannedAssetFile[] = [];
  if (!(await exists(assetsRoot))) {
    return planned;
  }
  for (const entry of await readdir(assetsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const groupSource = join(assetsRoot, entry.name);
    const groupDest = join("skills", entry.name);
    planned.push(...(await collectNestedFiles(groupSource, groupDest)));
  }
  return planned;
}

async function collectCommandFiles(assetsRoot: string): Promise<PlannedAssetFile[]> {
  const planned: PlannedAssetFile[] = [];
  if (!(await exists(assetsRoot))) {
    return planned;
  }
  for (const entry of await readdir(assetsRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      planned.push({
        sourcePath: join(assetsRoot, entry.name),
        relativeDest: join("commands", entry.name),
      });
    }
  }
  return planned;
}

async function collectNestedFiles(directory: string, relativeBase: string): Promise<PlannedAssetFile[]> {
  const planned: PlannedAssetFile[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const nestedSource = join(directory, entry.name);
    const nestedDest = join(relativeBase, entry.name);
    if (entry.isDirectory()) {
      planned.push(...(await collectNestedFiles(nestedSource, nestedDest)));
    } else {
      planned.push({ sourcePath: nestedSource, relativeDest: nestedDest });
    }
  }
  return planned;
}

async function removeStaleVersionMarkers(skillsBase: string): Promise<void> {
  if (!(await exists(skillsBase))) {
    return;
  }
  for (const entry of await readdir(skillsBase, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const markerPath = join(skillsBase, entry.name, ".version");
    if (await exists(markerPath)) {
      await rm(markerPath);
    }
  }
}

function toManifestPath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/");
}

function requiredRecordedHash(manifest: InstallManifest, relativePath: string): string {
  const recorded = manifest.recordedHash(relativePath);
  if (recorded === null) {
    throw new Error(`Manifest disposition required a recorded hash for: ${relativePath}`);
  }
  return recorded;
}

function writtenSkillDirs(configBase: string, writtenRelativePaths: string[]): string[] {
  const dirs = new Set<string>();
  for (const relativePath of writtenRelativePaths) {
    const manifestPath = toManifestPath(relativePath);
    if (!manifestPath.startsWith("skills/")) {
      continue;
    }
    const skillName = manifestPath.slice("skills/".length).split("/")[0];
    dirs.add(join(configBase, "skills", skillName));
  }
  return [...dirs];
}

function writtenCommandFiles(configBase: string, writtenRelativePaths: string[]): string[] {
  return writtenRelativePaths
    .map(toManifestPath)
    .filter(manifestPath => manifestPath.startsWith("commands/"))
    .map(manifestPath => join(configBase, manifestPath));
}

async function readJsonConfig(path: string): Promise<Record<string, unknown> | null> {
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return {};
    }
    return null;
  }
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function writeJsonConfig(path: string, config: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2));
}

async function ensureSkillPermission(configPath: string, packageName: string): Promise<boolean> {
  const config = await readJsonConfig(configPath);
  if (config === null) {
    console.warn(
      `[${packageName}] Refusing to write ${configPath}: the file is not valid JSON. ` +
        `Fix or remove the file, then re-run install. The file was left unchanged.`
    );
    return false;
  }

  if (!config.permission) {
    config.permission = {};
  }
  if (!(config.permission as Record<string, unknown>).skill) {
    (config.permission as Record<string, unknown>).skill = {};
  }
  const skillPerms = (config.permission as Record<string, unknown>).skill as Record<string, unknown>;
  if (skillPerms["intellisearch"] === "allow") {
    return false;
  }
  skillPerms["intellisearch"] = "allow";
  await writeJsonConfig(configPath, config);
  return true;
}

async function addMcpServer(configPath: string, packageName: string): Promise<boolean> {
  const config = await readJsonConfig(configPath);
  if (config === null) {
    console.warn(
      `[${packageName}] Refusing to write ${configPath}: the file is not valid JSON. ` +
        `Fix or remove the file, then re-run install. The file was left unchanged.`
    );
    return false;
  }

  if (!config.mcp) {
    config.mcp = {};
  }
  const mcp = config.mcp as Record<string, unknown>;
  const lowerKey = MCP_SERVER_NAME.toLowerCase();
  for (const key of Object.keys(mcp)) {
    if (key.toLowerCase() === lowerKey) {
      return false;
    }
  }
  mcp[MCP_SERVER_NAME] = {
    type: "remote",
    url: MCP_SERVER_URL,
    enabled: true,
  };
  await writeJsonConfig(configPath, config);
  return true;
}

async function addPluginToConfig(configPath: string, packageName: string): Promise<boolean> {
  const config = await readJsonConfig(configPath);
  if (config === null) {
    console.warn(
      `[${packageName}] Refusing to write ${configPath}: the file is not valid JSON. ` +
        `Fix or remove the file, then re-run install. The file was left unchanged.`
    );
    return false;
  }

  if (!config.plugin) {
    config.plugin = [];
  }

  const plugins = config.plugin as string[];
  if (plugins.some(entry => PluginNameNormalizer.matches(entry, packageName))) {
    return false;
  }

  plugins.push(PluginNameNormalizer.canonicalize(packageName));
  config.plugin = plugins;

  await writeJsonConfig(configPath, config);
  return true;
}

async function removePluginFromConfig(configPath: string, packageName: string): Promise<boolean> {
  const config = await readJsonConfig(configPath);
  if (config === null) {
    console.warn(
      `[${packageName}] Refusing to write ${configPath}: the file is not valid JSON. ` +
        `Fix or remove the file manually. The file was left unchanged.`
    );
    return false;
  }

  if (!config.plugin) {
    return false;
  }

  const plugins = config.plugin as string[];
  const remaining = plugins.filter(entry => !PluginNameNormalizer.matches(entry, packageName));

  if (remaining.length === plugins.length) {
    return false;
  }

  if (remaining.length === 0) {
    delete config.plugin;
  } else {
    config.plugin = remaining;
  }

  await writeJsonConfig(configPath, config);
  return true;
}

export async function isPluginInConfig(configPath: string, packageName: string): Promise<boolean> {
  const config = await readJsonConfig(configPath);
  if (config === null) {
    return false;
  }

  if (!config.plugin) {
    return false;
  }

  const plugins = config.plugin as string[];
  return plugins.some(entry => PluginNameNormalizer.matches(entry, packageName));
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
  options: { enabled: boolean },
  onConflict: RootConfigConflictHandler | null = null
): Promise<boolean> {
  if (!options.enabled) {
    return false;
  }

  const { needed, rootConfigPath, dotOpenencodeConfigPath, rootConfig, dotOpenencodeConfig } =
    await checkMigrationNeeded(projectDir);

  if (!needed) {
    return false;
  }

  if (rootConfig === null) {
    console.warn(
      `Refusing to migrate ${rootConfigPath}: the file is not valid JSON. ` +
        `Fix or remove the file, then re-run install. The file was left unchanged.`
    );
    return false;
  }

  if (dotOpenencodeConfig === null && (await exists(dotOpenencodeConfigPath))) {
    console.warn(
      `Refusing to migrate ${rootConfigPath}: ${dotOpenencodeConfigPath} is not valid JSON. ` +
        `Both files were left unchanged.`
    );
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
  projectDir: string = process.cwd(),
  options: InstallOptions
): Promise<InstallResult> {
  const packageName = await getPackageName();
  const packageVersion = await getPackageVersion();
  const pkgDir = await resolvePackageDir();

  const { addPluginConfig, migrateRootConfig: allowRootMigration, force } = options;
  const configurePermission = options.configurePermission ?? false;
  const configureMcp = options.configureMcp ?? false;

  const configBase = scope === "global" ? getGlobalConfigPath() : getLocalConfigPath(projectDir);
  const configPath = join(configBase, "opencode.json");
  const manifestPath = join(configBase, `${packageName}.manifest.json`);

  let migrated = false;

  if (scope === "local" && allowRootMigration) {
    migrated = await migrateRootConfig(projectDir, { enabled: true });
  }

  const manifest = await InstallManifest.read(manifestPath);
  const sameVersion = manifest.matchesVersion(packageVersion);
  const plannedFiles = await collectAssetFiles(pkgDir);

  const writtenRelativePaths: string[] = [];
  const skipped: string[] = [];
  const recordedFiles: ManifestFileEntry[] = [];

  for (const plannedFile of plannedFiles) {
    const manifestEntryPath = toManifestPath(plannedFile.relativeDest);
    const verdict = await manifest.disposition(configBase, plannedFile.relativeDest, sameVersion, force);

    if (verdict === "skip") {
      skipped.push(manifestEntryPath);
      recordedFiles.push({ path: manifestEntryPath, hash: requiredRecordedHash(manifest, plannedFile.relativeDest) });
      continue;
    }

    const installedPath = join(configBase, plannedFile.relativeDest);

    if (verdict === "keep") {
      recordedFiles.push({ path: manifestEntryPath, hash: requiredRecordedHash(manifest, plannedFile.relativeDest) });
      continue;
    }

    await mkdir(dirname(installedPath), { recursive: true });
    await copyFile(plannedFile.sourcePath, installedPath);
    const installedHash = await InstallManifest.hashFile(installedPath);
    if (installedHash === null) {
      throw new Error(`Failed to hash installed file: ${installedPath}`);
    }
    recordedFiles.push({ path: manifestEntryPath, hash: installedHash });
    writtenRelativePaths.push(plannedFile.relativeDest);
  }

  const action: InstallAction =
    writtenRelativePaths.length === 0 ? "noop" : manifest.hasContents() ? "upgraded" : "installed";

  if (action !== "noop") {
    await removeStaleVersionMarkers(join(configBase, "skills"));
    await InstallManifest.write(manifestPath, packageVersion, recordedFiles);
  }

  let pluginAdded = false;
  if (addPluginConfig) {
    pluginAdded = await addPluginToConfig(configPath, packageName);
  }

  let permissionConfigured = false;
  if (configurePermission) {
    permissionConfigured = await ensureSkillPermission(configPath, packageName);
  }

  let mcpConfigured = false;
  if (configureMcp) {
    mcpConfigured = await addMcpServer(configPath, packageName);
  }

  return {
    action,
    scope,
    skillPaths: writtenSkillDirs(configBase, writtenRelativePaths),
    commandPaths: writtenCommandFiles(configBase, writtenRelativePaths),
    configPath,
    manifestPath,
    skipped,
    migrated,
    pluginAdded,
    permissionConfigured,
    mcpConfigured,
    recommendations: [],
  };
}

export async function uninstall(
  scope: Scope,
  projectDir: string = process.cwd()
): Promise<UninstallResult> {
  const packageName = await getPackageName();

  const configBase = scope === "global" ? getGlobalConfigPath() : getLocalConfigPath(projectDir);
  const configPath = join(configBase, "opencode.json");

  const removed: string[] = [];

  const skillsPath = join(configBase, "skills");
  const commandsPath = join(configBase, "commands");

  if (await exists(skillsPath)) {
    for (const entry of await readdir(skillsPath, { withFileTypes: true })) {
      const entryPath = join(skillsPath, entry.name);
      if (entry.isDirectory()) {
        await rm(entryPath, { recursive: true });
        removed.push(entryPath);
      }
    }
  }

  if (await exists(commandsPath)) {
    for (const entry of await readdir(commandsPath, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const entryPath = join(commandsPath, entry.name);
        await rm(entryPath);
        removed.push(entryPath);
      }
    }
  }

  const manifestPath = join(configBase, `${packageName}.manifest.json`);
  if (await exists(manifestPath)) {
    await rm(manifestPath);
    removed.push(manifestPath);
  }

  let pluginRemoved = false;
  if (await exists(configPath)) {
    pluginRemoved = await removePluginFromConfig(configPath, packageName);
  }

  return { scope, removed, pluginRemoved };
}

export async function status(projectDir: string = process.cwd()): Promise<StatusResult> {
  const packageName = await getPackageName();
  return {
    local: await readScopeStatus(getLocalConfigPath(projectDir), packageName),
    global: await readScopeStatus(getGlobalConfigPath(), packageName),
  };
}

export async function isScopeInstalled(configBase: string, packageName: string): Promise<boolean> {
  return (await readScopeStatus(configBase, packageName)) !== null;
}

async function readScopeStatus(configBase: string, packageName: string): Promise<ScopeStatus | null> {
  const manifest = await InstallManifest.read(join(configBase, `${packageName}.manifest.json`));
  const legacySkillDir = join(configBase, "skills", "intellisearch");
  if (!manifest.hasContents() && !(await exists(legacySkillDir))) {
    return null;
  }
  const version = manifest.hasContents() ? manifest.version : await readLegacySkillVersion(legacySkillDir);
  const pluginInConfig = await isPluginInConfig(join(configBase, "opencode.json"), packageName);
  return { installed: true, version, pluginInConfig };
}

async function readLegacySkillVersion(skillDir: string): Promise<string | null> {
  try {
    return (await readFile(join(skillDir, ".version"), "utf-8")).trim();
  } catch {
    return null;
  }
}

export async function readLocalConfig(projectDir: string): Promise<Record<string, unknown> | null> {
  const localConfigPath = join(getLocalConfigPath(projectDir), "opencode.json");
  const config = await readJsonConfig(localConfigPath);
  if (config === null) {
    return null;
  }
  if (Object.keys(config).length === 0) {
    return null;
  }
  return config;
}

export function mergeConfigWithOverrides(
  input: Record<string, unknown>,
  localConfig: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(localConfig)) {
    if (key === "plugin" || key === "agent") {
      continue;
    }
    input[key] = value;
  }
}
