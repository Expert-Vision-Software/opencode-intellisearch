import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { install, uninstall } from "../../src/installer.ts";
import { JsoncReader } from "../../src/jsonc.ts";
import { snapshotDirectory } from "../helpers/snapshot.ts";

const TEST_DIR = join(import.meta.dirname, ".test-uninstall-purge");
const PACKAGE_NAME = "opencode-intellisearch";
const CANONICAL_PLUGIN_REF = `${PACKAGE_NAME}@latest`;

beforeAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
  await mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

async function makeFixture(name: string): Promise<string> {
  const fixtureDir = join(TEST_DIR, name);
  await rm(fixtureDir, { recursive: true, force: true });
  await mkdir(fixtureDir, { recursive: true });
  return fixtureDir;
}

async function writeLocalConfigText(fixtureDir: string, content: string): Promise<void> {
  const localDir = join(fixtureDir, ".opencode");
  await mkdir(localDir, { recursive: true });
  await writeFile(join(localDir, "opencode.json"), content);
}

async function readLocalConfigRaw(fixtureDir: string): Promise<string> {
  return readFile(join(fixtureDir, ".opencode", "opencode.json"), "utf-8");
}

async function captureWarnings(operation: () => Promise<void>): Promise<string[]> {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message: unknown) => {
    warnings.push(String(message));
  };
  try {
    await operation();
  } finally {
    console.warn = originalWarn;
  }
  return warnings;
}

function fullManagedConfig(plugin: string[]): string {
  return (
    "{\n" +
    '  "$schema": "https://opencode.ai/config.json",\n' +
    "  // consumer comment stays\n" +
    '  "model": "some/model",\n' +
    `  "plugin": ${JSON.stringify(plugin)},\n` +
    '  "permission": {\n' +
    '    "skill": {\n' +
    '      "other-skill": "allow",\n' +
    '      "intellisearch": "allow"\n' +
    "    }\n" +
    "  },\n" +
    '  "mcp": {\n' +
    '    "deepwiki": {\n' +
    '      "type": "remote",\n' +
    '      "url": "https://mcp.deepwiki.com/mcp",\n' +
    '      "enabled": true\n' +
    "    },\n" +
    '    "other-server": {\n' +
    '      "type": "remote",\n' +
    '      "url": "https://example.com/mcp"\n' +
    "    }\n" +
    "  }\n" +
    "}"
  );
}

interface ParsedShape {
  model?: string;
  plugin?: string[];
  permission?: { skill?: Record<string, string> };
  mcp?: Record<string, unknown>;
}

async function parseLocalConfig(fixtureDir: string): Promise<ParsedShape> {
  return JsoncReader.parse(await readLocalConfigRaw(fixtureDir)) as ParsedShape;
}

describe("uninstall config residue (conservative default)", () => {
  test("default uninstall removes the plugin entry but keeps the permission and MCP keys", async () => {
    const fixtureDir = await makeFixture("default-keeps-keys");
    await writeLocalConfigText(fixtureDir, fullManagedConfig(["other-plugin", CANONICAL_PLUGIN_REF]));

    const result = await uninstall("local", fixtureDir);

    expect(result.pluginRemoved).toBe(true);
    expect(result.permissionRemoved).toBe(false);
    expect(result.mcpRemoved).toBe(false);
    const config = await parseLocalConfig(fixtureDir);
    expect(config.plugin).toEqual(["other-plugin"]);
    expect(config.permission?.skill?.["intellisearch"]).toBe("allow");
    expect(config.permission?.skill?.["other-skill"]).toBe("allow");
    const server = config.mcp?.["deepwiki"] as { url?: string } | undefined;
    expect(server?.url).toBe("https://mcp.deepwiki.com/mcp");
    expect(config.mcp?.["other-server"]).toBeDefined();
    expect(config.model).toBe("some/model");
    expect(await readLocalConfigRaw(fixtureDir)).toContain("// consumer comment stays");
  });

  test("default uninstall after a real install keeps permission and MCP keys in place", async () => {
    const fixtureDir = await makeFixture("default-roundtrip");
    await install("local", fixtureDir, {
      mode: "plugin",
      addPluginConfig: true,
      migrateRootConfig: false,
      force: false,
      configurePermission: true,
      configureMcp: true,
    });

    const result = await uninstall("local", fixtureDir);

    expect(result.pluginRemoved).toBe(true);
    expect(result.permissionRemoved).toBe(false);
    expect(result.mcpRemoved).toBe(false);
    const config = await parseLocalConfig(fixtureDir);
    expect(config.plugin).toEqual([]);
    expect(config.permission?.skill?.["intellisearch"]).toBe("allow");
    expect(config.mcp?.["deepwiki"]).toBeDefined();
  });
});

describe("uninstall --purge-config", () => {
  test("removes exactly the package-managed entries and preserves unrelated keys", async () => {
    const fixtureDir = await makeFixture("purge-removes-managed");
    await writeLocalConfigText(fixtureDir, fullManagedConfig(["other-plugin", CANONICAL_PLUGIN_REF]));

    const result = await uninstall("local", fixtureDir, { purgeConfig: true });

    expect(result.pluginRemoved).toBe(true);
    expect(result.permissionRemoved).toBe(true);
    expect(result.mcpRemoved).toBe(true);
    const config = await parseLocalConfig(fixtureDir);
    expect(config.plugin).toEqual(["other-plugin"]);
    expect(config.permission?.skill?.["intellisearch"]).toBeUndefined();
    expect(config.permission?.skill?.["other-skill"]).toBe("allow");
    expect(config.mcp?.["deepwiki"]).toBeUndefined();
    expect(config.mcp?.["other-server"]).toBeDefined();
    expect(config.model).toBe("some/model");
    expect(await readLocalConfigRaw(fixtureDir)).toContain("// consumer comment stays");
  });

  test("removes package-managed entries written by a real install", async () => {
    const fixtureDir = await makeFixture("purge-roundtrip");
    await install("local", fixtureDir, {
      mode: "plugin",
      addPluginConfig: true,
      migrateRootConfig: false,
      force: false,
      configurePermission: true,
      configureMcp: true,
    });

    const result = await uninstall("local", fixtureDir, { purgeConfig: true });

    expect(result.pluginRemoved).toBe(true);
    expect(result.permissionRemoved).toBe(true);
    expect(result.mcpRemoved).toBe(true);
    const config = await parseLocalConfig(fixtureDir);
    expect(config.plugin).toEqual([]);
    expect(config.permission?.skill?.["intellisearch"]).toBeUndefined();
    expect(config.mcp?.["deepwiki"]).toBeUndefined();
  });

  test("performs no config writes when none of the package-managed entries exist", async () => {
    const fixtureDir = await makeFixture("purge-nothing-managed");
    await writeLocalConfigText(
      fixtureDir,
      "{\n" +
        '  "$schema": "https://opencode.ai/config.json",\n' +
        '  "model": "some/model",\n' +
        '  "plugin": ["other-plugin"]\n' +
        "}"
    );
    const before = await snapshotDirectory(fixtureDir);

    const result = await uninstall("local", fixtureDir, { purgeConfig: true });

    expect(result.pluginRemoved).toBe(false);
    expect(result.permissionRemoved).toBe(false);
    expect(result.mcpRemoved).toBe(false);
    expect(await snapshotDirectory(fixtureDir)).toEqual(before);
  });

  test("preserves an unparseable config byte-for-byte and warns", async () => {
    const fixtureDir = await makeFixture("purge-unparseable");
    const invalidContent =
      '{\n  "$schema": "https://opencode.ai/config.json",\n' +
      '  "plugin": [\n    "opencode-intellisearch"\n  ],\n' +
      '  "permission": { "skill": { "intellisearch": ;; } },\n}';
    await writeLocalConfigText(fixtureDir, invalidContent);

    const warnings = await captureWarnings(async () => {
      await uninstall("local", fixtureDir, { purgeConfig: true });
    });

    expect(await readLocalConfigRaw(fixtureDir)).toBe(invalidContent);
    expect(warnings.join("\n")).toContain("not valid JSON");
    expect(warnings.join("\n")).toContain("left unchanged");
  });
});
