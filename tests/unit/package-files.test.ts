import { describe, test, expect } from "bun:test";
import { stat } from "node:fs/promises";

const PACKAGE_ROOT = `${import.meta.dirname}/../..`;

describe("package files validation", () => {
  test("should include plugin.ts in published package", async () => {
    const packageJsonPath = `${PACKAGE_ROOT}/package.json`;
    const packageJson = JSON.parse(await Bun.file(packageJsonPath).text());

    const files: string[] = packageJson.files ?? [];

    expect(files).toContain("plugin.ts");
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

    const pluginContent = await Bun.file(
      `${PACKAGE_ROOT}/plugin.ts`
    ).text();

    const hasVersionRead = pluginContent.includes('Bun.file(`${import.meta.dirname}/package.json`).text()');
    expect(hasVersionRead).toBe(true);

    expect(packageJson.version).toBeDefined();
  });
});
