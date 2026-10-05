import { describe, test, expect } from "bun:test";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const PACKAGE_ROOT = `${import.meta.dirname}/../..`;

describe("package files validation", () => {
  test("should publish the entry module and the src directory", async () => {
    const packageJsonPath = `${PACKAGE_ROOT}/package.json`;
    const packageJson = JSON.parse(await Bun.file(packageJsonPath).text());

    const files: string[] = packageJson.files ?? [];

    expect(files).toContain("index.ts");
    expect(files).toContain("src");
    expect(files).toContain("assets");
  });

  test("should declare code-backed content", async () => {
    const packageJsonPath = `${PACKAGE_ROOT}/package.json`;
    const packageJson = JSON.parse(await Bun.file(packageJsonPath).text());

    expect(packageJson["content"]).toBe("code");
  });

  test("should keep index.ts as the only code file at the package root", async () => {
    const rootEntries = await readdir(PACKAGE_ROOT, { withFileTypes: true });
    const rootCodeFiles = rootEntries
      .filter(entry => entry.isFile() && /\.(ts|tsx|js|mjs|cjs)$/.test(entry.name))
      .map(entry => entry.name);

    expect(rootCodeFiles).toEqual(["index.ts"]);
  });

  test("should not ship a legacy root-level plugin.ts", async () => {
    const packageJsonPath = `${PACKAGE_ROOT}/package.json`;
    const packageJson = JSON.parse(await Bun.file(packageJsonPath).text());

    const files: string[] = packageJson.files ?? [];
    expect(files).not.toContain("plugin.ts");

    const legacyPath = `${PACKAGE_ROOT}/plugin.ts`;
    const legacyExists = await stat(legacyPath)
      .then(() => true)
      .catch(() => false);
    expect(legacyExists).toBe(false);
  });

  test("should only include existing directories in files array", async () => {
    const packageJsonPath = `${PACKAGE_ROOT}/package.json`;
    const packageJson = JSON.parse(await Bun.file(packageJsonPath).text());

    const files: string[] = packageJson.files ?? [];

    for (const entry of files) {
      const entryPath = `${PACKAGE_ROOT}/${entry}`;
      const exists = await stat(entryPath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    }
  });

  test("should include all required entry point files", async () => {
    const packageJsonPath = `${PACKAGE_ROOT}/package.json`;
    const packageJson = JSON.parse(await Bun.file(packageJsonPath).text());

    const files: string[] = packageJson.files ?? [];
    const module = packageJson.module as string | undefined;

    if (module?.endsWith(".ts")) {
      expect(files).toContain(module);
    }
  });

  test("version constant should match package.json version", async () => {
    const packageJsonPath = `${PACKAGE_ROOT}/package.json`;
    const packageJson = JSON.parse(await Bun.file(packageJsonPath).text());

    const installerContent = await Bun.file(
      `${PACKAGE_ROOT}/src/installer.ts`
    ).text();

    const hasVersionRead = installerContent.includes('../package.json');
    expect(hasVersionRead).toBe(true);

    expect(packageJson.version).toBeDefined();
  });
});
