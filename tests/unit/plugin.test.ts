import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, readdir } from "node:fs/promises";
import plugin from "../../plugin.ts";

const EXPECTED_VERSION: string = JSON.parse(
  await Bun.file(`${import.meta.dirname}/../../package.json`).text()
).version;
const TEST_DIR = `${import.meta.dirname}/../fixtures/test-project`;

describe("plugin", () => {
  beforeEach(async () => {
    // Clean up test directory
    try {
      await rm(TEST_DIR, { recursive: true });
    } catch {
      // Directory might not exist
    }
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(TEST_DIR, { recursive: true });
    } catch {
      // Directory might not exist
    }
  });

  test("should install assets on first run", async () => {
    const pluginInstance = await plugin({
      directory: TEST_DIR,
    } as any);

    await pluginInstance.config?.({} as any);

    const skillsDir = `${TEST_DIR}/.opencode/skills/intellisearch`;
    const skillsEntries = await readdir(skillsDir);
    expect(skillsEntries).toContain("SKILL.md");

    const commandsFile = `${TEST_DIR}/.opencode/commands/search-intelligently.md`;
    const commandsContent = await Bun.file(commandsFile).text();
    expect(commandsContent.length).toBeGreaterThan(0);

    const versionFile = `${skillsDir}/.version`;
    const version = await Bun.file(versionFile).text();
    expect(version.trim()).toBe(EXPECTED_VERSION);
  });

  test("should skip installation if version marker matches", async () => {
    const pluginInstance1 = await plugin({
      directory: TEST_DIR,
    } as any);
    await pluginInstance1.config?.({} as any);

    const skillsDir = `${TEST_DIR}/.opencode/skills/intellisearch`;
    const skillFile = `${skillsDir}/SKILL.md`;
    const firstMtime = (await Bun.file(skillFile).stat()).mtime;

    const pluginInstance2 = await plugin({
      directory: TEST_DIR,
    } as any);
    await pluginInstance2.config?.({} as any);

    const secondMtime = (await Bun.file(skillFile).stat()).mtime;
    expect(secondMtime.getTime()).toBe(firstMtime.getTime());
  });

  test("should re-install if version marker differs", async () => {
    const versionFile = `${TEST_DIR}/.opencode/skills/intellisearch/.version`;
    await mkdir(`${TEST_DIR}/.opencode/skills/intellisearch`, { recursive: true });
    await Bun.write(versionFile, "0.1.0");

    const pluginInstance = await plugin({
      directory: TEST_DIR,
    } as any);
    await pluginInstance.config?.({} as any);

    const version = await Bun.file(versionFile).text();
    expect(version.trim()).toBe(EXPECTED_VERSION);
  });

  test("should handle missing assets gracefully", async () => {
    const pluginInstance = await plugin({
      directory: TEST_DIR,
    } as any);

    await expect(pluginInstance.config?.({} as any)).resolves.toBeUndefined();
  });
});
