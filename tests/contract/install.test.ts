import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { exists, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { install, collectAssetFiles, migrateRootConfig, uninstall, type InstallOptions } from "../../src/installer.ts";
import { PluginNameNormalizer } from "../../src/plugin-name.ts";
import { JsoncReader } from "../../src/jsonc.ts";
import { snapshotDirectory } from "../helpers/snapshot.ts";
import { SANDBOX_GLOBAL_BASE, resetGlobalConfig, withGlobalSandbox } from "../helpers/global-sandbox.ts";

const TEST_DIR = join(import.meta.dirname, ".test-install");
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

async function writeLocalConfig(fixtureDir: string, config: Record<string, unknown>): Promise<void> {
  const localDir = join(fixtureDir, ".opencode");
  await mkdir(localDir, { recursive: true });
  await writeFile(join(localDir, "opencode.json"), JSON.stringify(config, null, 2));
}

async function readLocalConfigRaw(fixtureDir: string): Promise<string> {
  return readFile(join(fixtureDir, ".opencode", "opencode.json"), "utf-8");
}

async function readPluginArray(fixtureDir: string): Promise<string[]> {
  const config = JSON.parse(await readLocalConfigRaw(fixtureDir)) as Record<string, unknown>;
  return (config["plugin"] as string[]) ?? [];
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

const INSTALL_OPTIONS: InstallOptions = {
  mode: "plugin",
  addPluginConfig: false,
  migrateRootConfig: false,
  force: false,
  configurePermission: false,
  configureMcp: false,
};

describe("PluginNameNormalizer", () => {
  test("normalize strips a version suffix", () => {
    expect(PluginNameNormalizer.normalize("opencode-intellisearch@0.1.0")).toBe(PACKAGE_NAME);
  });

  test("normalize strips the @latest tag", () => {
    expect(PluginNameNormalizer.normalize("opencode-intellisearch@latest")).toBe(PACKAGE_NAME);
  });

  test("normalize lowercases and trims", () => {
    expect(PluginNameNormalizer.normalize("  OpenCode-IntelliSearch ")).toBe(PACKAGE_NAME);
  });

  test("canonicalize emits the name@latest form", () => {
    expect(PluginNameNormalizer.canonicalize(PACKAGE_NAME)).toBe(CANONICAL_PLUGIN_REF);
    expect(PluginNameNormalizer.canonicalize(`${PACKAGE_NAME}@1.0.0`)).toBe(CANONICAL_PLUGIN_REF);
  });

  test("matches treats bare, @latest, and pinned references as the same package", () => {
    expect(PluginNameNormalizer.matches(PACKAGE_NAME, PACKAGE_NAME)).toBe(true);
    expect(PluginNameNormalizer.matches(CANONICAL_PLUGIN_REF, PACKAGE_NAME)).toBe(true);
    expect(PluginNameNormalizer.matches(`${PACKAGE_NAME}@0.1.0`, PACKAGE_NAME)).toBe(true);
    expect(PluginNameNormalizer.matches("some-other-plugin", PACKAGE_NAME)).toBe(false);
  });
});

describe("surgical config writes", () => {
  test("install splices the plugin entry into a 4-space-indented config with comments, byte-identical otherwise", async () => {
    const fixtureDir = await makeFixture("splice-4space");
    const localDir = join(fixtureDir, ".opencode");
    await mkdir(localDir, { recursive: true });
    const before =
      "{\n" +
      '    "$schema": "https://opencode.ai/config.json",\n' +
      "    // my preferred model\n" +
      '    "model": "some/model"\n' +
      "}";
    await writeFile(join(localDir, "opencode.json"), before);

    const result = await install("local", fixtureDir, {
      mode: "plugin",
      addPluginConfig: true,
      migrateRootConfig: false,
      force: false,
      configurePermission: false,
      configureMcp: false,
    });

    expect(result.pluginAdded).toBe(true);
    const after = await readLocalConfigRaw(fixtureDir);
    const expected =
      "{\n" +
      `    "plugin": ["${CANONICAL_PLUGIN_REF}"],\n` +
      '    "$schema": "https://opencode.ai/config.json",\n' +
      "    // my preferred model\n" +
      '    "model": "some/model"\n' +
      "}";
    expect(after).toBe(expected);
  });

  test("install splices the plugin entry into a config with comments and a trailing comma, preserving both", async () => {
    const fixtureDir = await makeFixture("splice-jsonc");
    const localDir = join(fixtureDir, ".opencode");
    await mkdir(localDir, { recursive: true });
    const before =
      "{\n" +
      "  // my config\n" +
      '  "$schema": "https://opencode.ai/config.json",\n' +
      '  "model": "some/model", // inline comment\n' +
      "}";
    const configPath = join(localDir, "opencode.json");
    await writeFile(configPath, before);

    const result = await install("local", fixtureDir, {
      mode: "plugin",
      addPluginConfig: true,
      migrateRootConfig: false,
      force: false,
      configurePermission: false,
      configureMcp: false,
    });

    expect(result.pluginAdded).toBe(true);
    const after = await readFile(configPath, "utf-8");
    expect(after).toContain("// my config");
    expect(after).toContain("// inline comment");
    expect(after).toContain(`"plugin": ["${CANONICAL_PLUGIN_REF}"],`);
    const parsed = JsoncReader.parse(after) as Record<string, unknown>;
    expect(parsed["plugin"]).toEqual([CANONICAL_PLUGIN_REF]);
    expect(parsed["model"]).toBe("some/model");
  });

  test("permission splice into an existing config preserves unrelated keys and formatting", async () => {
    const fixtureDir = await makeFixture("splice-permission");
    const localDir = join(fixtureDir, ".opencode");
    await mkdir(localDir, { recursive: true });
    const before =
      "{\n" +
      '  "$schema": "https://opencode.ai/config.json",\n' +
      "  // keep me\n" +
      '  "model": "some/model"\n' +
      "}";
    await writeFile(join(localDir, "opencode.json"), before);

    const result = await install("local", fixtureDir, {
      mode: "plugin",
      addPluginConfig: false,
      migrateRootConfig: false,
      force: false,
      configurePermission: true,
      configureMcp: false,
    });

    expect(result.permissionConfigured).toBe(true);
    const after = await readLocalConfigRaw(fixtureDir);
    expect(after).toContain("// keep me");
    expect(after).toContain('"model": "some/model"');
    const parsed = JsoncReader.parse(after) as { permission?: { skill?: Record<string, string> } };
    expect(parsed.permission?.skill?.["intellisearch"]).toBe("allow");
  });

  test("mcp splice into an existing config preserves unrelated keys and formatting", async () => {
    const fixtureDir = await makeFixture("splice-mcp");
    const localDir = join(fixtureDir, ".opencode");
    await mkdir(localDir, { recursive: true });
    const before =
      "{\n" +
      '  "$schema": "https://opencode.ai/config.json",\n' +
      "  /* block comment */\n" +
      '  "model": "some/model"\n' +
      "}";
    await writeFile(join(localDir, "opencode.json"), before);

    const result = await install("local", fixtureDir, {
      mode: "plugin",
      addPluginConfig: false,
      migrateRootConfig: false,
      force: false,
      configurePermission: false,
      configureMcp: true,
    });

    expect(result.mcpConfigured).toBe(true);
    const after = await readLocalConfigRaw(fixtureDir);
    expect(after).toContain("/* block comment */");
    const parsed = JsoncReader.parse(after) as { mcp?: Record<string, unknown> };
    const server = parsed.mcp?.["deepwiki"] as { url?: string };
    expect(server?.url).toBe("https://mcp.deepwiki.com/mcp");
  });
});

describe("config writes over unparseable JSON", () => {
  test("install refuses to rewrite a genuinely malformed local opencode.json and preserves it byte-for-byte", async () => {
    const fixtureDir = await makeFixture("invalid-local-config");
    const localDir = join(fixtureDir, ".opencode");
    await mkdir(localDir, { recursive: true });
    const invalidContent =
      '{\n  "$schema": "https://opencode.ai/config.json",\n  "plugin": [\n    "opencode-architect"\n  ],\n  "model": ;;;\n}';
    await writeFile(join(localDir, "opencode.json"), invalidContent);

    let pluginAdded = true;
    const warnings = await captureWarnings(async () => {
      const result = await install("local", fixtureDir, {
        mode: "plugin",
        addPluginConfig: true,
        migrateRootConfig: false,
        force: false,
        configurePermission: false,
        configureMcp: false,
      });
      pluginAdded = result.pluginAdded;
    });

    expect(pluginAdded).toBe(false);
    expect(await readLocalConfigRaw(fixtureDir)).toBe(invalidContent);
    expect(warnings.join("\n")).toContain("not valid JSON");
    expect(warnings.join("\n")).toContain("left unchanged");
  });

  test("install splices into a trailing-comma opencode.json without destroying the trailing comma", async () => {
    const fixtureDir = await makeFixture("trailing-comma-local-config");
    const localDir = join(fixtureDir, ".opencode");
    await mkdir(localDir, { recursive: true });
    const before =
      '{\n  "$schema": "https://opencode.ai/config.json",\n  "plugin": [\n    "opencode-architect"\n  ],\n}';
    await writeFile(join(localDir, "opencode.json"), before);

    const result = await install("local", fixtureDir, {
      mode: "plugin",
      addPluginConfig: true,
      migrateRootConfig: false,
      force: false,
      configurePermission: false,
      configureMcp: false,
    });

    expect(result.pluginAdded).toBe(true);
    const after = await readLocalConfigRaw(fixtureDir);
    expect(after).toBe(
      '{\n  "$schema": "https://opencode.ai/config.json",\n  "plugin": [\n    "opencode-intellisearch@latest",\n    "opencode-architect"\n  ],\n}'
    );
  });

  test("migrateRootConfig refuses to migrate when the root config is unparseable and preserves it byte-for-byte", async () => {
    const fixtureDir = await makeFixture("invalid-root-config");
    const invalidRoot = "{\n  \"model\": \"some/model\",\n}";
    await writeFile(join(fixtureDir, "opencode.json"), invalidRoot);

    let migrated = true;
    const warnings = await captureWarnings(async () => {
      migrated = await migrateRootConfig(fixtureDir, { enabled: true });
    });

    expect(migrated).toBe(false);
    expect(await readFile(join(fixtureDir, "opencode.json"), "utf-8")).toBe(invalidRoot);
    expect(await exists(join(fixtureDir, ".opencode", "opencode.json"))).toBe(false);
    expect(warnings.join("\n")).toContain("left unchanged");
  });
});

describe("loud asset absence", () => {
  test("missing commands asset directory fails loudly while skills exists", async () => {
    const fixtureDir = await makeFixture("missing-commands");
    const fakePackageDir = join(fixtureDir, "package");
    await mkdir(join(fakePackageDir, "assets", "skills", "intellisearch"), { recursive: true });
    await writeFile(join(fakePackageDir, "assets", "skills", "intellisearch", "SKILL.md"), "payload");
    await mkdir(join(fakePackageDir, "assets"), { recursive: true });

    let thrown: unknown = null;
    try {
      await collectAssetFiles(fakePackageDir, PACKAGE_NAME, "0.0.0-test");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain(join(fakePackageDir, "assets", "commands"));
    expect(message).toContain(PACKAGE_NAME);
    expect(message).toContain("clear-cache");
    expect(message).toContain("install --scope global");
  });

  test("empty skills asset directory fails loudly", async () => {
    const fixtureDir = await makeFixture("empty-skills");
    const fakePackageDir = join(fixtureDir, "package");
    await mkdir(join(fakePackageDir, "assets", "skills"), { recursive: true });
    await mkdir(join(fakePackageDir, "assets", "commands"), { recursive: true });
    await writeFile(join(fakePackageDir, "assets", "commands", "search-intelligently.md"), "payload");

    expect(collectAssetFiles(fakePackageDir, PACKAGE_NAME, "0.0.0-test")).rejects.toThrow(PACKAGE_NAME);
  });
});

describe("canonical plugin references", () => {
  test("install writes the plugin reference canonically as name@latest", async () => {
    const fixtureDir = await makeFixture("canonical-fresh");
    const result = await install("local", fixtureDir, {
      mode: "plugin",
      addPluginConfig: true,
      migrateRootConfig: false,
      force: false,
      configurePermission: false,
      configureMcp: false,
    });

    expect(result.pluginAdded).toBe(true);
    const plugins = await readPluginArray(fixtureDir);
    expect(plugins).toEqual([CANONICAL_PLUGIN_REF]);
  });

  test("install does not append a duplicate when a bare name is already present", async () => {
    const fixtureDir = await makeFixture("dedup-bare-name");
    await writeLocalConfig(fixtureDir, {
      $schema: "https://opencode.ai/config.json",
      plugin: [PACKAGE_NAME],
    });

    const result = await install("local", fixtureDir, {
      mode: "plugin",
      addPluginConfig: true,
      migrateRootConfig: false,
      force: false,
      configurePermission: false,
      configureMcp: false,
    });

    expect(result.pluginAdded).toBe(false);
    expect(await readPluginArray(fixtureDir)).toEqual([PACKAGE_NAME]);
  });

  test("install does not append a duplicate when a pinned version is already present", async () => {
    const fixtureDir = await makeFixture("dedup-pinned");
    await writeLocalConfig(fixtureDir, {
      $schema: "https://opencode.ai/config.json",
      plugin: [`${PACKAGE_NAME}@0.2.0`],
    });

    const result = await install("local", fixtureDir, {
      mode: "plugin",
      addPluginConfig: true,
      migrateRootConfig: false,
      force: false,
      configurePermission: false,
      configureMcp: false,
    });

    expect(result.pluginAdded).toBe(false);
    expect(await readPluginArray(fixtureDir)).toEqual([`${PACKAGE_NAME}@0.2.0`]);
  });

  test("uninstall removes the plugin across all reference spellings", async () => {
    const fixtureDir = await makeFixture("uninstall-semantic");
    await writeLocalConfig(fixtureDir, {
      $schema: "https://opencode.ai/config.json",
      plugin: [PACKAGE_NAME, CANONICAL_PLUGIN_REF],
    });

    const result = await uninstall("local", fixtureDir);

    expect(result.pluginRemoved).toBe(true);
    expect(await readPluginArray(fixtureDir)).toEqual([]);
  });
});

describe("manifest-scoped uninstall", () => {
  test("uninstall removes only manifest-recorded files and leaves foreign payload untouched", async () => {
    const fixtureDir = await makeFixture("uninstall-manifest-scoped");
    await install("local", fixtureDir, INSTALL_OPTIONS);

    const localDir = join(fixtureDir, ".opencode");
    const foreignSkillDir = join(localDir, "skills", "some-other-skill");
    await mkdir(foreignSkillDir, { recursive: true });
    await writeFile(join(foreignSkillDir, "SKILL.md"), "foreign");
    await writeFile(join(localDir, "commands", "foreign-command.md"), "foreign");

    const result = await uninstall("local", fixtureDir);

    expect(await exists(join(localDir, "skills", "intellisearch"))).toBe(false);
    expect(await exists(join(localDir, "commands", "search-intelligently.md"))).toBe(false);
    expect(await exists(foreignSkillDir)).toBe(true);
    expect(await readFile(join(foreignSkillDir, "SKILL.md"), "utf-8")).toBe("foreign");
    expect(await exists(join(localDir, "commands", "foreign-command.md"))).toBe(true);
    expect(await exists(join(localDir, `${PACKAGE_NAME}.manifest.json`))).toBe(false);
    expect(result.removed.length).toBeGreaterThan(0);
    for (const removedPath of result.removed) {
      expect(removedPath.startsWith(localDir)).toBe(true);
      expect(removedPath.includes("some-other-skill")).toBe(false);
      expect(removedPath.includes("foreign-command")).toBe(false);
    }
  });

  test("uninstall without a manifest removes no payload files", async () => {
    const fixtureDir = await makeFixture("uninstall-no-manifest");
    const localDir = join(fixtureDir, ".opencode");
    const skillDir = join(localDir, "skills", "intellisearch");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "unmanaged");
    await writeLocalConfig(fixtureDir, {
      $schema: "https://opencode.ai/config.json",
      plugin: [PACKAGE_NAME],
    });

    const result = await uninstall("local", fixtureDir);

    expect(await readFile(join(skillDir, "SKILL.md"), "utf-8")).toBe("unmanaged");
    expect(result.pluginRemoved).toBe(true);
    expect(result.removed).toEqual([]);
  });
});

describe("install manifest", () => {
  test("first install writes a manifest at the local config-dir root with per-file sha256 entries", async () => {
    const fixtureDir = await makeFixture("manifest-first");
    const result = await install("local", fixtureDir, INSTALL_OPTIONS);

    expect(result.action).toBe("installed");
    expect(result.manifestPath).toBe(join(fixtureDir, ".opencode", `${PACKAGE_NAME}.manifest.json`));

    const manifest = JSON.parse(await readFile(result.manifestPath, "utf-8")) as {
      version: string;
      files: Array<{ path: string; hash: string }>;
    };
    expect(manifest.version.length).toBeGreaterThanOrEqual(1);
    expect(manifest.files.length).toBeGreaterThanOrEqual(1);
    for (const entry of manifest.files) {
      expect(entry.path).toMatch(/^(skills|commands)\//);
      expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("first install removes legacy .version markers", async () => {
    const fixtureDir = await makeFixture("manifest-legacy-markers");
    const legacySkillDir = join(fixtureDir, ".opencode", "skills", "intellisearch");
    await mkdir(legacySkillDir, { recursive: true });
    await writeFile(join(legacySkillDir, ".version"), "0.1.0");

    const result = await install("local", fixtureDir, INSTALL_OPTIONS);

    expect(result.action).toBe("installed");
    expect(await exists(join(legacySkillDir, ".version"))).toBe(false);
  });

  test("reinstall at the same version with unchanged files is a no-op that writes nothing", async () => {
    const fixtureDir = await makeFixture("manifest-noop");
    await install("local", fixtureDir, INSTALL_OPTIONS);
    const before = await snapshotDirectory(fixtureDir);

    const result = await install("local", fixtureDir, INSTALL_OPTIONS);
    const after = await snapshotDirectory(fixtureDir);

    expect(result.action).toBe("noop");
    expect(result.skipped).toEqual([]);
    expect(after).toEqual(before);
  });

  test("consumer-modified files are skipped and preserved unless forced", async () => {
    const fixtureDir = await makeFixture("manifest-drift");
    await install("local", fixtureDir, INSTALL_OPTIONS);
    const skillFile = join(fixtureDir, ".opencode", "skills", "intellisearch", "SKILL.md");
    await writeFile(skillFile, "# consumer modified this file");

    const driftResult = await install("local", fixtureDir, INSTALL_OPTIONS);
    expect(driftResult.action).toBe("noop");
    expect(driftResult.skipped).toEqual(["skills/intellisearch/SKILL.md"]);
    expect(await readFile(skillFile, "utf-8")).toBe("# consumer modified this file");

    const forcedResult = await install("local", fixtureDir, {
      ...INSTALL_OPTIONS,
      force: true,
    });
    expect(forcedResult.action).toBe("upgraded");
    expect(forcedResult.skipped).toEqual([]);
    const restored = await readFile(skillFile, "utf-8");
    expect(restored.startsWith("---")).toBe(true);
  });

  test("a manifest whose recorded version differs from the package upgrades the install", async () => {
    const fixtureDir = await makeFixture("manifest-version-drift");
    await install("local", fixtureDir, INSTALL_OPTIONS);
    const manifestPath = join(fixtureDir, ".opencode", `${PACKAGE_NAME}.manifest.json`);
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as { version: string };
    manifest.version = "0.0.1";
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const result = await install("local", fixtureDir, INSTALL_OPTIONS);

    expect(result.action).toBe("upgraded");
    const rewritten = JSON.parse(await readFile(manifestPath, "utf-8")) as { version: string };
    expect(rewritten.version).not.toBe("0.0.1");
  });

  test("global scope places the manifest at the root of the effective global config dir", async () => {
    await withGlobalSandbox(async () => {
      const fixtureDir = await makeFixture("manifest-global");
      await resetGlobalConfig();
      const result = await install("global", fixtureDir, INSTALL_OPTIONS);
      expect(result.action).toBe("installed");
      expect(result.manifestPath).toBe(join(SANDBOX_GLOBAL_BASE, `${PACKAGE_NAME}.manifest.json`));
      expect(await exists(result.manifestPath)).toBe(true);
    });
  });
});

describe("root config migration guard", () => {
  test("install without the migration option leaves a root opencode.json untouched", async () => {
    const fixtureDir = await makeFixture("migration-disabled");
    await writeFile(
      join(fixtureDir, "opencode.json"),
      JSON.stringify({ $schema: "https://opencode.ai/config.json", model: "some/model" }, null, 2)
    );

    const result = await install("local", fixtureDir, INSTALL_OPTIONS);

    expect(result.migrated).toBe(false);
    expect(await exists(join(fixtureDir, "opencode.json"))).toBe(true);
  });

  test("install with the migration option moves the root config into .opencode", async () => {
    const fixtureDir = await makeFixture("migration-enabled");
    await writeFile(
      join(fixtureDir, "opencode.json"),
      JSON.stringify({ $schema: "https://opencode.ai/config.json", model: "some/model" }, null, 2)
    );

    const result = await install("local", fixtureDir, {
      ...INSTALL_OPTIONS,
      addPluginConfig: true,
      migrateRootConfig: true,
    });

    expect(result.migrated).toBe(true);
    expect(await exists(join(fixtureDir, "opencode.json"))).toBe(false);
    const migrated = JSON.parse(await readLocalConfigRaw(fixtureDir)) as Record<string, unknown>;
    expect(migrated["model"]).toBe("some/model");
    expect(migrated["plugin"]).toEqual([CANONICAL_PLUGIN_REF]);
  });

  test("migration merge preserves the dot config formatting and carries root-only keys", async () => {
    const fixtureDir = await makeFixture("migration-merge-splice");
    const rootContent =
      "{\n" +
      '  "$schema": "https://opencode.ai/config.json",\n' +
      '  "model": "root/model"\n' +
      "}";
    await writeFile(join(fixtureDir, "opencode.json"), rootContent);
    const localDir = join(fixtureDir, ".opencode");
    await mkdir(localDir, { recursive: true });
    const dotContent =
      "{\n" +
      "  // dot config stays authoritative\n" +
      '  "model": "dot/model"\n' +
      "}";
    await writeFile(join(localDir, "opencode.json"), dotContent);

    const migrated = await migrateRootConfig(fixtureDir, { enabled: true });

    expect(migrated).toBe(true);
    expect(await exists(join(fixtureDir, "opencode.json"))).toBe(false);
    const after = await readFile(join(localDir, "opencode.json"), "utf-8");
    expect(after).toContain("// dot config stays authoritative");
    const parsed = JsoncReader.parse(after) as Record<string, unknown>;
    expect(parsed["model"]).toBe("dot/model");
    expect(parsed["$schema"]).toBe("https://opencode.ai/config.json");
  });
});

describe("permission and MCP config (CLI-driven)", () => {
  test("install configures the skill permission when requested", async () => {
    const fixtureDir = await makeFixture("permission-cli");
    const result = await install("local", fixtureDir, {
      mode: "plugin",
      addPluginConfig: true,
      configurePermission: true,
      configureMcp: false,
      migrateRootConfig: false,
      force: false,
    });

    expect(result.permissionConfigured).toBe(true);
    const config = JSON.parse(await readLocalConfigRaw(fixtureDir)) as Record<string, unknown>;
    const permission = config["permission"] as { skill?: Record<string, string> };
    expect(permission?.skill?.["intellisearch"]).toBe("allow");
  });

  test("install configures the DeepWiki MCP server when requested", async () => {
    const fixtureDir = await makeFixture("mcp-cli");
    const result = await install("local", fixtureDir, {
      mode: "plugin",
      addPluginConfig: true,
      configurePermission: false,
      configureMcp: true,
      migrateRootConfig: false,
      force: false,
    });

    expect(result.mcpConfigured).toBe(true);
    const config = JSON.parse(await readLocalConfigRaw(fixtureDir)) as Record<string, unknown>;
    const mcp = config["mcp"] as Record<string, unknown>;
    const server = mcp?.["deepwiki"] as { type?: string; url?: string; enabled?: boolean };
    expect(server?.type).toBe("remote");
    expect(server?.url).toBe("https://mcp.deepwiki.com/mcp");
    expect(server?.enabled).toBe(true);
  });

  test("permission and MCP config are skipped when disabled", async () => {
    const fixtureDir = await makeFixture("config-disabled");
    const result = await install("local", fixtureDir, INSTALL_OPTIONS);

    expect(result.permissionConfigured).toBe(false);
    expect(result.mcpConfigured).toBe(false);
    expect(await exists(join(fixtureDir, ".opencode", "opencode.json"))).toBe(false);
  });
});
