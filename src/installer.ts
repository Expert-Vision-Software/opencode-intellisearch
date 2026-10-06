import { copyFile, exists, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { PluginNameNormalizer } from "./plugin-name.ts";
import { JsoncReader } from "./jsonc.ts";
import { JsonSpliceEditor } from "./json-splice-editor.ts";
import { AssetSourceMissingError } from "./asset-source-missing-error.ts";
import { CopyModeUnsupportedError } from "./copy-mode-unsupported-error.ts";
import { InstallManifest, type ManifestFileEntry } from "./manifest.ts";

export type Scope = "local" | "global";

export type InstallMode = "copy" | "plugin";

export interface InstallOptions {
  mode: InstallMode;
  addPluginConfig: boolean;
  migrateRootConfig: boolean;
  force: boolean;
  configurePermission: boolean;
  configureMcp: boolean;
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
  clearedCache: string[];
}

export interface UninstallOptions {
  purgeConfig: boolean;
}

export interface UninstallResult {
  scope: Scope;
  removed: string[];
  pluginRemoved: boolean;
  permissionRemoved: boolean;
  mcpRemoved: boolean;
}

export interface EnsureAssetsResult {
  skipped: string[];
}

export interface CacheOutcome {
  removed: string[];
  warnings: string[];
}

export interface ScopeStatus {
  installed: boolean;
  version: string | null;
  pluginInConfig: boolean;
}

export interface StatusResult {
  local: ScopeStatus | null;
  global: ScopeStatus | null;
}

const MCP_SERVER_NAME = "deepwiki";
const MCP_SERVER_URL = "https://mcp.deepwiki.com/mcp";
const ASSET_LAYOUT_DIR = ".";

const editor = new JsonSpliceEditor();

export async function getPackageVersion(): Promise<string> {
  const content = await Bun.file(`${import.meta.dirname}/../package.json`).text();
  return JSON.parse(content).version;
}

export async function getPackageName(): Promise<string> {
  const content = await Bun.file(`${import.meta.dirname}/../package.json`).text();
  return JSON.parse(content).name;
}

async function getContentDeclaration(): Promise<"assets" | "code"> {
  const content = await Bun.file(`${import.meta.dirname}/../package.json`).text();
  return JSON.parse(content).content === "code" ? "code" : "assets";
}

export async function resolveMode(packageName: string, requested: InstallMode): Promise<InstallMode> {
  if ((await getContentDeclaration()) === "code") {
    if (requested === "copy") {
      throw new CopyModeUnsupportedError(packageName);
    }
    return "plugin";
  }
  return requested;
}

function getPackageDir(): string {
  return join(import.meta.dirname, "..");
}

function packageCacheRoot(): string {
  const xdgCacheHome = process.env.XDG_CACHE_HOME;
  if (xdgCacheHome) {
    return join(xdgCacheHome, "opencode", "packages");
  }
  return join(homedir(), ".cache", "opencode", "packages");
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

function isFileNotFoundError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function removeCacheTargets(packagesRoot: string, wanted: (name: string) => boolean): Promise<CacheOutcome> {
  const removed: string[] = [];
  const warnings: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(packagesRoot);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return { removed, warnings };
    }
    warnings.push(`Could not read the OpenCode package cache root ${packagesRoot}: ${describeError(error)}`);
    return { removed, warnings };
  }
  const targets = entries
    .filter(wanted)
    .sort()
    .map(name => join(packagesRoot, name));
  for (const target of targets) {
    try {
      await rm(target, { recursive: true });
      removed.push(target);
    } catch (error) {
      warnings.push(`Could not clear cached package ${target}: ${describeError(error)}`);
    }
  }
  return { removed, warnings };
}

export async function prunePackageCache(): Promise<CacheOutcome> {
  const packageName = await getPackageName();
  const version = await getPackageVersion();
  const wanted = [packageName, `${packageName}@latest`, `${packageName}@${version}`];
  return removeCacheTargets(packageCacheRoot(), name => wanted.includes(name));
}

export async function clearPackageCache(): Promise<CacheOutcome> {
  const packageName = await getPackageName();
  const versionPrefix = `${packageName}@`;
  return removeCacheTargets(packageCacheRoot(), name => name === packageName || name.startsWith(versionPrefix));
}

interface PlannedAssetFile {
  sourcePath: string;
  relativeDest: string;
}

export async function collectAssetFiles(
  packageDir: string,
  packageName: string,
  packageVersion: string
): Promise<PlannedAssetFile[]> {
  const layoutRoot = join(packageDir, ASSET_LAYOUT_DIR);
  const planned: PlannedAssetFile[] = [];
  planned.push(...(await collectSkillFiles(join(layoutRoot, "skills"), packageName, packageVersion)));
  planned.push(...(await collectCommandFiles(join(layoutRoot, "commands"), packageName, packageVersion)));
  return planned;
}

async function requireAssetDir(path: string, packageName: string, packageVersion: string): Promise<void> {
  const dirExists = await exists(path);
  const entryCount = dirExists ? (await readdir(path)).length : 0;
  if (!dirExists || entryCount === 0) {
    throw new AssetSourceMissingError(path, packageName, packageVersion, packageCacheRoot());
  }
}

async function collectSkillFiles(
  assetsRoot: string,
  packageName: string,
  packageVersion: string
): Promise<PlannedAssetFile[]> {
  await requireAssetDir(assetsRoot, packageName, packageVersion);
  const planned: PlannedAssetFile[] = [];
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

async function collectCommandFiles(
  assetsRoot: string,
  packageName: string,
  packageVersion: string
): Promise<PlannedAssetFile[]> {
  await requireAssetDir(assetsRoot, packageName, packageVersion);
  const planned: PlannedAssetFile[] = [];
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

function parseConfigText(content: string, configPath: string): Record<string, unknown> | null {
  try {
    return JsoncReader.parseConfigFile(content, configPath) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseConfigTextLenient(content: string): Record<string, unknown> | null {
  try {
    return JsoncReader.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
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
  return parseConfigText(content, path);
}

async function readConfigText(configPath: string): Promise<string | null> {
  if (!(await exists(configPath))) {
    return null;
  }
  return readFile(configPath, "utf-8");
}

async function writeCreatedConfig(configPath: string, content: string): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, content);
}

function pluginArrayContains(config: Record<string, unknown>, packageName: string): boolean {
  const plugins = config["plugin"];
  if (!Array.isArray(plugins)) {
    return false;
  }
  return plugins.some(entry => typeof entry === "string" && PluginNameNormalizer.matches(entry, packageName));
}

function warnUnparseableConfig(configPath: string, packageName: string, operation: string): void {
  console.warn(
    `[${packageName}] Refusing to modify ${configPath}: the file is not valid JSON. ` +
      `The file was left unchanged. Fix or remove the file, then re-run the ${operation}.`
  );
}

function warnUnspliceableConfig(configPath: string, packageName: string, operation: string): void {
  console.warn(
    `[${packageName}] Refusing to modify ${configPath}: the change could not be applied as a safe text splice. ` +
      `The file was left unchanged. Fix or remove the conflicting structure, then re-run the ${operation}.`
  );
}

async function writeSplicedConfig(configPath: string, spliced: string): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, spliced);
}

async function addPluginToConfig(configPath: string, packageName: string): Promise<boolean> {
  const canonical = PluginNameNormalizer.canonicalize(packageName);
  const text = await readConfigText(configPath);
  if (text === null) {
    await writeCreatedConfig(configPath, `{\n  "plugin": ["${canonical}"]\n}\n`);
    return true;
  }
  const config = parseConfigTextLenient(text);
  if (config === null) {
    warnUnparseableConfig(configPath, packageName, "install");
    return false;
  }
  if (pluginArrayContains(config, packageName)) {
    return false;
  }
  const hasPluginKey = "plugin" in config;
  const spliced = hasPluginKey
    ? editor.addArrayElement(text, "plugin", `"${canonical}"`, true)
    : editor.setObjectEntry(text, ["plugin"], `["${canonical}"]`, true);
  if (spliced === null) {
    warnUnspliceableConfig(configPath, packageName, "install");
    return false;
  }
  await writeSplicedConfig(configPath, spliced);
  return true;
}

async function removePluginFromConfig(configPath: string, packageName: string): Promise<boolean> {
  const text = await readConfigText(configPath);
  if (text === null) {
    return false;
  }
  const config = parseConfigTextLenient(text);
  if (config === null) {
    warnUnparseableConfig(configPath, packageName, "uninstall");
    return false;
  }
  if (!pluginArrayContains(config, packageName)) {
    return false;
  }
  const spliced = editor.removeArrayElements(
    text,
    "plugin",
    entry => PluginNameNormalizer.matches(entry, packageName),
    true
  );
  if (spliced === null) {
    warnUnspliceableConfig(configPath, packageName, "uninstall");
    return false;
  }
  await writeSplicedConfig(configPath, spliced);
  return true;
}

async function removeSkillPermissionFromConfig(configPath: string, packageName: string): Promise<boolean> {
  const text = await readConfigText(configPath);
  if (text === null) {
    return false;
  }
  const config = parseConfigTextLenient(text);
  if (config === null) {
    warnUnparseableConfig(configPath, packageName, "uninstall");
    return false;
  }
  if (!hasSkillIntellisearchEntry(config)) {
    return false;
  }
  const spliced = editor.removeObjectEntry(text, ["permission", "skill", "intellisearch"], true);
  if (spliced === null) {
    warnUnspliceableConfig(configPath, packageName, "uninstall");
    return false;
  }
  await writeSplicedConfig(configPath, spliced);
  return true;
}

async function removeMcpServerFromConfig(configPath: string, packageName: string): Promise<boolean> {
  const text = await readConfigText(configPath);
  if (text === null) {
    return false;
  }
  const config = parseConfigTextLenient(text);
  if (config === null) {
    warnUnparseableConfig(configPath, packageName, "uninstall");
    return false;
  }
  if (!hasManagedMcpServerEntry(config)) {
    return false;
  }
  const spliced = editor.removeObjectEntry(text, ["mcp", MCP_SERVER_NAME], true);
  if (spliced === null) {
    warnUnspliceableConfig(configPath, packageName, "uninstall");
    return false;
  }
  await writeSplicedConfig(configPath, spliced);
  return true;
}

function permissionAllowValue(config: Record<string, unknown>): string | null {
  const permission = config["permission"];
  if (typeof permission !== "object" || permission === null) {
    return null;
  }
  const skill = (permission as Record<string, unknown>)["skill"];
  if (typeof skill !== "object" || skill === null) {
    return null;
  }
  const value = (skill as Record<string, unknown>)["intellisearch"];
  return typeof value === "string" ? value : null;
}

function hasSkillIntellisearchEntry(config: Record<string, unknown>): boolean {
  const permission = config["permission"];
  if (typeof permission !== "object" || permission === null) {
    return false;
  }
  const skill = (permission as Record<string, unknown>)["skill"];
  if (typeof skill !== "object" || skill === null) {
    return false;
  }
  return "intellisearch" in (skill as Record<string, unknown>);
}

function hasManagedMcpServerEntry(config: Record<string, unknown>): boolean {
  const mcp = config["mcp"];
  if (typeof mcp !== "object" || mcp === null) {
    return false;
  }
  return MCP_SERVER_NAME in (mcp as Record<string, unknown>);
}

async function ensureSkillPermission(configPath: string, packageName: string): Promise<boolean> {
  const text = await readConfigText(configPath);
  if (text === null) {
    await writeCreatedConfig(
      configPath,
      `{\n  "permission": {\n    "skill": {\n      "intellisearch": "allow"\n    }\n  }\n}\n`
    );
    return true;
  }
  const config = parseConfigTextLenient(text);
  if (config === null) {
    warnUnparseableConfig(configPath, packageName, "install");
    return false;
  }
  if (permissionAllowValue(config) === "allow") {
    return false;
  }
  const spliced = editor.setObjectEntry(text, ["permission", "skill", "intellisearch"], `"allow"`, true);
  if (spliced === null) {
    warnUnspliceableConfig(configPath, packageName, "install");
    return false;
  }
  await writeSplicedConfig(configPath, spliced);
  return true;
}

function hasDeepWikiServer(config: Record<string, unknown>): boolean {
  const mcp = config["mcp"];
  if (typeof mcp !== "object" || mcp === null) {
    return false;
  }
  const lowerName = MCP_SERVER_NAME.toLowerCase();
  return Object.keys(mcp as Record<string, unknown>).some(key => key.toLowerCase() === lowerName);
}

async function addMcpServer(configPath: string, packageName: string): Promise<boolean> {
  const text = await readConfigText(configPath);
  const serverBody = JSON.stringify({ type: "remote", url: MCP_SERVER_URL, enabled: true });
  if (text === null) {
    await writeCreatedConfig(
      configPath,
      `{\n  "mcp": {\n    "${MCP_SERVER_NAME}": ${serverBody}\n  }\n}\n`
    );
    return true;
  }
  const config = parseConfigTextLenient(text);
  if (config === null) {
    warnUnparseableConfig(configPath, packageName, "install");
    return false;
  }
  if (hasDeepWikiServer(config)) {
    return false;
  }
  const spliced = editor.setObjectEntry(text, ["mcp", MCP_SERVER_NAME], serverBody, true);
  if (spliced === null) {
    warnUnspliceableConfig(configPath, packageName, "install");
    return false;
  }
  await writeSplicedConfig(configPath, spliced);
  return true;
}

export async function isPluginInConfig(configPath: string, packageName: string): Promise<boolean> {
  let content: string;
  try {
    content = await readFile(configPath, "utf-8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false;
    }
    console.warn(
      `Warning: ${configPath} could not be read; treating it as unregistered. The file was left unchanged.`
    );
    return false;
  }
  const config = parseConfigText(content, configPath);
  if (config === null) {
    console.warn(
      `Warning: ${configPath} is not valid JSON; treating it as unregistered. The file was left unchanged.`
    );
    return false;
  }
  return pluginArrayContains(config, packageName);
}

export async function isPluginRegisteredInBase(configBase: string, packageName: string): Promise<boolean> {
  const jsonOutcome = await isPluginInConfig(join(configBase, "opencode.json"), packageName);
  const jsoncOutcome = await isPluginInConfig(join(configBase, "opencode.jsonc"), packageName);
  return jsonOutcome || jsoncOutcome;
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

function rootValueRawText(rootText: string, key: string): string | null {
  const range = editor.topLevelValueRange(rootText, key);
  if (range === null) {
    return null;
  }
  return rootText.slice(range.start, range.end).trim();
}

export async function migrateRootConfig(
  projectDir: string,
  options: { enabled: boolean },
  onConflict: RootConfigConflictHandler | null = null
): Promise<boolean> {
  if (!options.enabled) {
    return false;
  }

  const { needed, rootConfigPath, dotOpenencodeConfigPath, rootConfig } =
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

  const dotText = await readConfigText(dotOpenencodeConfigPath);

  if (dotText === null) {
    await mkdir(join(projectDir, ".opencode"), { recursive: true });
    await copyFile(rootConfigPath, dotOpenencodeConfigPath);
    await rm(rootConfigPath);
    return true;
  }

  const dotConfig = parseConfigTextLenient(dotText);
  if (dotConfig === null) {
    console.warn(
      `Refusing to migrate ${rootConfigPath}: ${dotOpenencodeConfigPath} is not valid JSON. ` +
        `Both files were left unchanged.`
    );
    return false;
  }

  const hasConflict = Object.keys(rootConfig).some(key => key in dotConfig);
  if (hasConflict && onConflict) {
    const shouldContinue = await onConflict(rootConfig, dotConfig);
    if (!shouldContinue) {
      return false;
    }
  }

  const rootText = await readFile(rootConfigPath, "utf-8");
  let mergedText = dotText;
  for (const key of Object.keys(rootConfig)) {
    if (key in dotConfig) {
      continue;
    }
    const rawValue = rootValueRawText(rootText, key);
    if (rawValue === null) {
      console.warn(
        `Refusing to migrate ${rootConfigPath}: the key "${key}" could not be carried over safely. ` +
          `Both files were left unchanged.`
      );
      return false;
    }
    const next = editor.setObjectEntry(mergedText, [key], rawValue, true);
    if (next === null) {
      console.warn(
        `Refusing to migrate ${rootConfigPath}: ${dotOpenencodeConfigPath} could not be edited safely. ` +
          `Both files were left unchanged.`
      );
      return false;
    }
    mergedText = next;
  }

  await writeFile(dotOpenencodeConfigPath, mergedText);
  await rm(rootConfigPath);
  return true;
}

async function applyInstall(
  scope: Scope,
  projectDir: string,
  options: InstallOptions
): Promise<InstallResult> {
  const packageName = await getPackageName();
  const packageVersion = await getPackageVersion();
  await resolveMode(packageName, options.mode);

  const configBase = scope === "global" ? getGlobalConfigPath() : getLocalConfigPath(projectDir);
  const configPath = join(configBase, "opencode.json");
  const manifestPath = join(configBase, `${packageName}.manifest.json`);

  let migrated = false;

  if (scope === "local" && options.migrateRootConfig) {
    migrated = await migrateRootConfig(projectDir, { enabled: true });
  }

  const manifest = await InstallManifest.read(manifestPath);
  const sameVersion = manifest.matchesVersion(packageVersion);
  const plannedFiles = await collectAssetFiles(getPackageDir(), packageName, packageVersion);

  const writtenRelativePaths: string[] = [];
  const skipped: string[] = [];
  const recordedFiles: ManifestFileEntry[] = [];

  for (const plannedFile of plannedFiles) {
    const manifestEntryPath = toManifestPath(plannedFile.relativeDest);
    const verdict = await manifest.disposition(configBase, plannedFile.relativeDest, sameVersion, options.force);

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
  if (options.addPluginConfig) {
    pluginAdded = await addPluginToConfig(configPath, packageName);
  }

  let permissionConfigured = false;
  if (options.configurePermission) {
    permissionConfigured = await ensureSkillPermission(configPath, packageName);
  }

  let mcpConfigured = false;
  if (options.configureMcp) {
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
    clearedCache: [],
  };
}

export async function install(
  scope: Scope,
  projectDir: string = process.cwd(),
  options: InstallOptions
): Promise<InstallResult> {
  const cache = await prunePackageCache();
  for (const warning of cache.warnings) {
    console.warn(`Warning: ${warning}`);
  }
  const result = await applyInstall(scope, projectDir, options);
  return { ...result, clearedCache: cache.removed };
}

export async function ensureAssets(
  scope: Scope,
  projectDir: string,
  force: boolean
): Promise<EnsureAssetsResult> {
  const result = await applyInstall(scope, projectDir, {
    mode: "plugin",
    addPluginConfig: false,
    migrateRootConfig: false,
    force,
    configurePermission: false,
    configureMcp: false,
  });
  return { skipped: result.skipped };
}

async function removeEmptiedManifestDirs(
  configBase: string,
  files: ManifestFileEntry[],
  removed: string[]
): Promise<void> {
  const dirs = new Set<string>();
  for (const entry of files) {
    const segments = entry.path.split("/");
    if (segments.length < 2) {
      continue;
    }
    dirs.add(join(configBase, ...segments.slice(0, -1)));
  }
  const ordered = [...dirs].sort((a, b) => b.length - a.length);
  for (const dir of ordered) {
    let contents: string[];
    try {
      contents = await readdir(dir);
    } catch {
      continue;
    }
    if (contents.length > 0) {
      continue;
    }
    try {
      await rm(dir, { recursive: true });
      removed.push(dir);
    } catch {
      continue;
    }
  }
}

export async function uninstall(
  scope: Scope,
  projectDir: string = process.cwd(),
  options: UninstallOptions = { purgeConfig: false }
): Promise<UninstallResult> {
  const packageName = await getPackageName();

  const configBase = scope === "global" ? getGlobalConfigPath() : getLocalConfigPath(projectDir);
  const configPath = join(configBase, "opencode.json");
  const manifestPath = join(configBase, `${packageName}.manifest.json`);

  const removed: string[] = [];
  const manifest = await InstallManifest.read(manifestPath);

  if (manifest.hasContents()) {
    for (const entry of manifest.recordedFiles()) {
      const absolutePath = join(configBase, entry.path);
      if (!(await exists(absolutePath))) {
        continue;
      }
      await rm(absolutePath, { recursive: true });
      removed.push(absolutePath);
    }
    await removeEmptiedManifestDirs(configBase, manifest.recordedFiles(), removed);
    await rm(manifestPath);
    removed.push(manifestPath);
  }

  let pluginRemoved = false;
  let permissionRemoved = false;
  let mcpRemoved = false;
  if (await exists(configPath)) {
    pluginRemoved = await removePluginFromConfig(configPath, packageName);
    if (options.purgeConfig) {
      permissionRemoved = await removeSkillPermissionFromConfig(configPath, packageName);
      mcpRemoved = await removeMcpServerFromConfig(configPath, packageName);
    }
  }

  return { scope, removed, pluginRemoved, permissionRemoved, mcpRemoved };
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
  const pluginInConfig = await isPluginRegisteredInBase(configBase, packageName);
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
