import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, readdir, stat } from "node:fs/promises";
import plugin from "../../plugin.ts";

const EXPECTED_VERSION: string = JSON.parse(
  await Bun.file(`${import.meta.dirname}/../../package.json`).text()
).version;
const TEST_PROJECT_DIR = `${import.meta.dirname}/../fixtures/integration-test-project`;

describe("integration", () => {
  beforeAll(async () => {
    try {
      await rm(TEST_PROJECT_DIR, { recursive: true });
    } catch {
      // Directory might not exist
    }
    await mkdir(TEST_PROJECT_DIR, { recursive: true });
  });

  afterAll(async () => {
    try {
      await rm(TEST_PROJECT_DIR, { recursive: true });
    } catch {
      // Directory might not exist
    }
  });

  describe("plugin installation", () => {
    test("should create complete .opencode structure", async () => {
      const pluginInstance = await plugin({
        directory: TEST_PROJECT_DIR,
      } as any);

      await pluginInstance.config?.({} as any);

      const opencodeDir = `${TEST_PROJECT_DIR}/.opencode`;
      const entries = await readdir(opencodeDir);
      expect(entries).toContain("skills");
      expect(entries).toContain("commands");

      const skillsDir = `${opencodeDir}/skills/intellisearch`;
      const skillEntries = await readdir(skillsDir);
      expect(skillEntries).toContain("SKILL.md");
      expect(skillEntries).toContain(".version");

      const commandsFile = `${opencodeDir}/commands/search-intelligently.md`;
      const commandsStats = await stat(commandsFile);
      expect(commandsStats.isFile()).toBe(true);
    });

    test("should copy skill files correctly", async () => {
      const pluginInstance = await plugin({
        directory: TEST_PROJECT_DIR,
      } as any);

      await pluginInstance.config?.({} as any);

      const skillFile = `${TEST_PROJECT_DIR}/.opencode/skills/intellisearch/SKILL.md`;
      const skillContent = await Bun.file(skillFile).text();
      
      expect(skillContent).toContain("---");
      expect(skillContent).toContain("name:");
      expect(skillContent).toContain("description:");
      
      expect(skillContent.length).toBeGreaterThan(100);
    });

    test("should copy command file correctly", async () => {
      const pluginInstance = await plugin({
        directory: TEST_PROJECT_DIR,
      } as any);

      await pluginInstance.config?.({} as any);

      const commandFile = `${TEST_PROJECT_DIR}/.opencode/commands/search-intelligently.md`;
      const commandContent = await Bun.file(commandFile).text();

      expect(commandContent).toContain("---");
      expect(commandContent).toContain("description:");
      expect(commandContent).toContain("agent:");
      
      expect(commandContent.length).toBeGreaterThan(100);
    });
  });

  describe("version management", () => {
    test("should create correct version marker", async () => {
      const pluginInstance = await plugin({
        directory: TEST_PROJECT_DIR,
      } as any);

      await pluginInstance.config?.({} as any);

      const versionFile = `${TEST_PROJECT_DIR}/.opencode/skills/intellisearch/.version`;
      const version = await Bun.file(versionFile).text();
      
      expect(version.trim()).toBe(EXPECTED_VERSION);
    });

    test("should not overwrite files when version matches", async () => {
      const pluginInstance1 = await plugin({
        directory: TEST_PROJECT_DIR,
      } as any);
      await pluginInstance1.config?.({} as any);

      const skillFile = `${TEST_PROJECT_DIR}/.opencode/skills/intellisearch/SKILL.md`;
      const firstStats = await stat(skillFile);

      const pluginInstance2 = await plugin({
        directory: TEST_PROJECT_DIR,
      } as any);
      await pluginInstance2.config?.({} as any);

      const secondStats = await stat(skillFile);

      expect(secondStats.mtime.getTime()).toBe(firstStats.mtime.getTime());
    });
  });

  describe("cross-platform compatibility", () => {
    test("should use correct path separators", async () => {
      const pluginInstance = await plugin({
        directory: TEST_PROJECT_DIR,
      } as any);

      await pluginInstance.config?.({} as any);

      const skillsExist = await stat(`${TEST_PROJECT_DIR}/.opencode/skills/intellisearch`)
        .then(() => true)
        .catch(() => false);
      
      const commandsExist = await stat(`${TEST_PROJECT_DIR}/.opencode/commands/search-intelligently.md`)
        .then(() => true)
        .catch(() => false);

      expect(skillsExist).toBe(true);
      expect(commandsExist).toBe(true);
    });
  });
});
