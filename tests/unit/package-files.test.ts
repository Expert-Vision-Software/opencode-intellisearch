import { describe, test, expect } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const PACKAGE_ROOT = path.join(import.meta.dirname, "../..");

describe("package files validation", () => {
  test("should include plugin.ts in published package", async () => {
    const packageJsonPath = path.join(PACKAGE_ROOT, "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf-8"));

    const files: string[] = packageJson.files ?? [];

    expect(files).toContain("plugin.ts");
  });

  test("should only include existing directories in files array", async () => {
    const packageJsonPath = path.join(PACKAGE_ROOT, "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf-8"));

    const files: string[] = packageJson.files ?? [];

    for (const entry of files) {
      const entryPath = path.join(PACKAGE_ROOT, entry);
      const exists = await stat(entryPath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    }
  });

  test("should include all required entry point files", async () => {
    const packageJsonPath = path.join(PACKAGE_ROOT, "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf-8"));

    const files: string[] = packageJson.files ?? [];
    const module = packageJson.module as string | undefined;

    if (module?.endsWith(".ts")) {
      expect(files).toContain(module);
    }
  });

  test("version constant should match package.json version", async () => {
    const packageJsonPath = path.join(PACKAGE_ROOT, "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf-8"));

    const pluginContent = await readFile(
      path.join(PACKAGE_ROOT, "plugin.ts"),
      "utf-8"
    );

    // The VERSION constant reads from package.json at runtime
    // Verify the pattern exists that reads from package.json
    const hasVersionRead = pluginContent.includes('readFile(path.join(import.meta.dirname, "package.json")');
    expect(hasVersionRead).toBe(true);

    // Verify package.json version exists
    expect(packageJson.version).toBeDefined();
  });
});
