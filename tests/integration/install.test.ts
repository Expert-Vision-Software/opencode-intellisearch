import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { install, uninstall, status, checkMigrationNeeded, type Scope } from "../../src/installer.ts";
import {
  createTestEnv,
  assertFileExists,
  readJsonFile,
  getSkillPath,
  getCommandPath,
  getConfigPath,
  getVersionMarkerPath,
  getGlobalSkillPath,
  getGlobalCommandPath,
  getGlobalConfigPath,
  getGlobalVersionMarkerPath,
  type TestEnv,
} from "./fixtures/test-env.ts";

interface PermissionConfig {
  skill?: Record<string, string>;
  tool?: Record<string, string>;
}

interface McpConfig {
  type: string;
  url: string;
  enabled: boolean;
}

interface OpenencodeConfig {
  model?: string;
  permission?: PermissionConfig;
  plugin?: string[];
  mcp?: Record<string, McpConfig>;
}

function getSkillPermission(config: OpenencodeConfig | null): string | undefined {
  return config?.permission?.skill?.intellisearch;
}

function getToolPermission(config: OpenencodeConfig | null, tool: string): string | undefined {
  return config?.permission?.tool?.[tool];
}

function hasPlugin(config: OpenencodeConfig | null, pluginName: string): boolean {
  return config?.plugin?.includes(pluginName) ?? false;
}

function hasMcpServer(config: OpenencodeConfig | null, serverName: string): boolean {
  if (!config?.mcp) return false;
  const lowerName = serverName.toLowerCase();
  return Object.keys(config.mcp).some(key => key.toLowerCase() === lowerName);
}

describe("install command", () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await createTestEnv();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  describe("local scope", () => {
    it("installs to project .opencode directory", async () => {
      process.env.XDG_CONFIG_HOME = env.xdgConfigHome;

      const result = await install("local", env.projectDir);

      expect(result.scope).toBe("local");
      expect(result.migrated).toBe(false);

      const skillExists = await assertFileExists(getSkillPath(env.projectDir));
      expect(skillExists).toBe(true);

      const commandExists = await assertFileExists(getCommandPath(env.projectDir));
      expect(commandExists).toBe(true);

      const configPath = getConfigPath(env.projectDir);
      const config = await readJsonFile<OpenencodeConfig>(configPath);
      expect(config).not.toBeNull();
      expect(getSkillPermission(config)).toBe("allow");

      const versionExists = await assertFileExists(getVersionMarkerPath(env.projectDir));
      expect(versionExists).toBe(true);
    });

    it("is idempotent - reinstall works", async () => {
      process.env.XDG_CONFIG_HOME = env.xdgConfigHome;

      await install("local", env.projectDir);
      const result = await install("local", env.projectDir);

      expect(result.scope).toBe("local");
      expect(await assertFileExists(getSkillPath(env.projectDir))).toBe(true);
    });

    it("preserves existing config when installing", async () => {
      process.env.XDG_CONFIG_HOME = env.xdgConfigHome;

      env = await createTestEnv({
        withDotOpenencode: true,
        withDotOpenencodeJsonContent: {
          model: "existing-model",
          permission: {
            tool: {
              bash: "ask",
            },
          },
        },
      });

      await install("local", env.projectDir);

      const config = await readJsonFile<OpenencodeConfig>(getConfigPath(env.projectDir));
      expect(config).not.toBeNull();
      expect(config?.model).toBe("existing-model");
      expect(getToolPermission(config, "bash")).toBe("ask");
      expect(getSkillPermission(config)).toBe("allow");
    });
  });

  describe("global scope", () => {
    it("installs to XDG_CONFIG_HOME/opencode directory", async () => {
      process.env.XDG_CONFIG_HOME = env.xdgConfigHome;

      const result = await install("global", env.projectDir);

      expect(result.scope).toBe("global");

      const { getGlobalSkillPath, getGlobalCommandPath, getGlobalConfigPath, getGlobalVersionMarkerPath } = 
        await import("./fixtures/test-env.ts");

      const skillExists = await assertFileExists(getGlobalSkillPath(env.xdgConfigHome));
      expect(skillExists).toBe(true);

      const commandExists = await assertFileExists(getGlobalCommandPath(env.xdgConfigHome));
      expect(commandExists).toBe(true);

      const config = await readJsonFile<OpenencodeConfig>(getGlobalConfigPath(env.xdgConfigHome));
      expect(config).not.toBeNull();
      expect(getSkillPermission(config)).toBe("allow");

      const versionExists = await assertFileExists(getGlobalVersionMarkerPath(env.xdgConfigHome));
      expect(versionExists).toBe(true);
    });
  });
});

describe("uninstall command", () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await createTestEnv();
    process.env.XDG_CONFIG_HOME = env.xdgConfigHome;
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it("removes local installation", async () => {
    await install("local", env.projectDir);
    const result = await uninstall("local", env.projectDir);

    expect(result.removed.length).toBeGreaterThan(0);
    expect(await assertFileExists(getSkillPath(env.projectDir))).toBe(false);
    expect(await assertFileExists(getCommandPath(env.projectDir))).toBe(false);
  });

  it("removes global installation", async () => {
    await install("global", env.projectDir);
    const result = await uninstall("global", env.projectDir);

    expect(result.removed.length).toBeGreaterThan(0);

    const { getGlobalSkillPath, getGlobalCommandPath } = await import("./fixtures/test-env.ts");
    expect(await assertFileExists(getGlobalSkillPath(env.xdgConfigHome))).toBe(false);
    expect(await assertFileExists(getGlobalCommandPath(env.xdgConfigHome))).toBe(false);
  });

  it("handles uninstall when not installed", async () => {
    const result = await uninstall("local", env.projectDir);
    expect(result.removed.length).toBe(0);
  });

  it("removes empty parent directories", async () => {
    await install("local", env.projectDir);
    await uninstall("local", env.projectDir);

    const { join } = await import("node:path");
    const skillsDir = join(env.projectDir, ".opencode", "skills");
    const commandsDir = join(env.projectDir, ".opencode", "commands");

    expect(await assertFileExists(skillsDir)).toBe(false);
    expect(await assertFileExists(commandsDir)).toBe(false);
  });
});

describe("status command", () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await createTestEnv();
    process.env.XDG_CONFIG_HOME = env.xdgConfigHome;
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it("returns not installed when neither local nor global", async () => {
    const result = await status(env.projectDir);

    expect(result.local?.installed).toBeFalsy();
    expect(result.global?.installed).toBeFalsy();
  });

  it("detects local installation", async () => {
    await install("local", env.projectDir);
    const result = await status(env.projectDir);

    expect(result.local?.installed).toBe(true);
    expect(result.local?.version).not.toBeNull();
  });

  it("detects global installation", async () => {
    await install("global", env.projectDir);
    const result = await status(env.projectDir);

    expect(result.global?.installed).toBe(true);
    expect(result.global?.version).not.toBeNull();
  });

  it("detects both installations", async () => {
    await install("local", env.projectDir);
    await install("global", env.projectDir);
    const result = await status(env.projectDir);

    expect(result.local?.installed).toBe(true);
    expect(result.global?.installed).toBe(true);
  });

  it("detects plugin in config", async () => {
    await install("local", env.projectDir);
    const result = await status(env.projectDir);

    expect(result.local?.pluginInConfig).toBe(true);
  });
});

describe("plugin config", () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await createTestEnv();
    process.env.XDG_CONFIG_HOME = env.xdgConfigHome;
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it("adds plugin to config by default", async () => {
    const result = await install("local", env.projectDir);
    expect(result.pluginAdded).toBe(true);

    const config = await readJsonFile<OpenencodeConfig>(getConfigPath(env.projectDir));
    expect(hasPlugin(config, "opencode-intellisearch")).toBe(true);
  });

  it("skips plugin config when option is false", async () => {
    const result = await install("local", env.projectDir, { addPluginConfig: false });
    expect(result.pluginAdded).toBe(false);

    const config = await readJsonFile<OpenencodeConfig>(getConfigPath(env.projectDir));
    expect(hasPlugin(config, "opencode-intellisearch")).toBe(false);
  });

  it("preserves existing plugins", async () => {
    env = await createTestEnv({
      withDotOpenencode: true,
      withDotOpenencodeJsonContent: {
        plugin: ["existing-plugin"],
      },
    });

    await install("local", env.projectDir);

    const config = await readJsonFile<OpenencodeConfig>(getConfigPath(env.projectDir));
    expect(hasPlugin(config, "existing-plugin")).toBe(true);
    expect(hasPlugin(config, "opencode-intellisearch")).toBe(true);
  });

  it("removes plugin from config on uninstall", async () => {
    await install("local", env.projectDir);
    
    let config = await readJsonFile<OpenencodeConfig>(getConfigPath(env.projectDir));
    expect(hasPlugin(config, "opencode-intellisearch")).toBe(true);

    const result = await uninstall("local", env.projectDir);
    expect(result.pluginRemoved).toBe(true);

    config = await readJsonFile<OpenencodeConfig>(getConfigPath(env.projectDir));
    expect(hasPlugin(config, "opencode-intellisearch")).toBe(false);
  });

  it("preserves other plugins on uninstall", async () => {
    env = await createTestEnv({
      withDotOpenencode: true,
      withDotOpenencodeJsonContent: {
        plugin: ["existing-plugin", "opencode-intellisearch"],
      },
    });

    await uninstall("local", env.projectDir);

    const config = await readJsonFile<OpenencodeConfig>(getConfigPath(env.projectDir));
    expect(hasPlugin(config, "existing-plugin")).toBe(true);
    expect(hasPlugin(config, "opencode-intellisearch")).toBe(false);
  });
});

describe("mcp config", () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await createTestEnv();
    process.env.XDG_CONFIG_HOME = env.xdgConfigHome;
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it("adds deepwiki MCP server by default", async () => {
    const result = await install("local", env.projectDir);
    expect(result.mcpConfigured).toBe(true);

    const config = await readJsonFile<OpenencodeConfig>(getConfigPath(env.projectDir));
    expect(hasMcpServer(config, "deepwiki")).toBe(true);
    
    const mcp = config?.mcp?.deepwiki;
    expect(mcp?.type).toBe("remote");
    expect(mcp?.url).toBe("https://mcp.deepwiki.com/mcp");
    expect(mcp?.enabled).toBe(true);
  });

  it("skips MCP config when option is false", async () => {
    const result = await install("local", env.projectDir, { configureMcp: false });
    expect(result.mcpConfigured).toBe(false);

    const config = await readJsonFile<OpenencodeConfig>(getConfigPath(env.projectDir));
    expect(hasMcpServer(config, "deepwiki")).toBe(false);
  });

  it("does not duplicate MCP server with different casing", async () => {
    env = await createTestEnv({
      withDotOpenencode: true,
      withDotOpenencodeJsonContent: {
        mcp: {
          DeepWiki: {
            type: "remote",
            url: "https://mcp.deepwiki.com/mcp",
            enabled: true,
          },
        },
      },
    });

    const result = await install("local", env.projectDir);
    expect(result.mcpConfigured).toBe(false);

    const config = await readJsonFile<OpenencodeConfig>(getConfigPath(env.projectDir));
    const mcpKeys = Object.keys(config?.mcp || {});
    expect(mcpKeys.length).toBe(1);
  });

  it("preserves MCP config on uninstall", async () => {
    await install("local", env.projectDir);
    await uninstall("local", env.projectDir);

    const config = await readJsonFile<OpenencodeConfig>(getConfigPath(env.projectDir));
    expect(hasMcpServer(config, "deepwiki")).toBe(true);
  });
});

describe("install options", () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await createTestEnv();
    process.env.XDG_CONFIG_HOME = env.xdgConfigHome;
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it("skips permission config when option is false", async () => {
    const result = await install("local", env.projectDir, { configurePermission: false });
    expect(result.permissionConfigured).toBe(false);

    const config = await readJsonFile<OpenencodeConfig>(getConfigPath(env.projectDir));
    expect(getSkillPermission(config)).toBeUndefined();
  });

  it("configures all options by default", async () => {
    const result = await install("local", env.projectDir);

    expect(result.permissionConfigured).toBe(true);
    expect(result.mcpConfigured).toBe(true);
    expect(result.pluginAdded).toBe(true);
  });
});
