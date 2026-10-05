import { describe, test, expect, afterEach } from "bun:test";
import { join } from "node:path";
import { exists, mkdir, rm, writeFile } from "node:fs/promises";
import { clearPackageCache, prunePackageCache } from "../../src/installer.ts";
import { SANDBOX_CACHE_PACKAGES } from "../helpers/global-sandbox.ts";

const TEST_DIR = join(import.meta.dirname, ".test-cache");
const PACKAGE_NAME = "opencode-intellisearch";
const PACKAGE_VERSION = JSON.parse(
  await Bun.file(`${import.meta.dirname}/../../package.json`).text()
).version;

const PACKAGES_ROOT = join(TEST_DIR, "opencode", "packages");

const INHERITED_CACHE_HOME = process.env.XDG_CACHE_HOME ?? SANDBOX_CACHE_PACKAGES;

async function useSandboxedCache(): Promise<void> {
  process.env.XDG_CACHE_HOME = TEST_DIR;
  await mkdir(PACKAGES_ROOT, { recursive: true });
}

afterEach(async () => {
  process.env.XDG_CACHE_HOME = INHERITED_CACHE_HOME;
  await rm(TEST_DIR, { recursive: true, force: true });
});

async function seedCacheDir(name: string): Promise<string> {
  const dir = join(PACKAGES_ROOT, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "marker.txt"), "seeded");
  return dir;
}

describe("clearPackageCache (self-only)", () => {
  test("removes bare, @latest, and versioned copies of this package only", async () => {
    await useSandboxedCache();
    const bare = await seedCacheDir(PACKAGE_NAME);
    const latest = await seedCacheDir(`${PACKAGE_NAME}@latest`);
    const pinned = await seedCacheDir(`${PACKAGE_NAME}@${PACKAGE_VERSION}`);
    const otherVersion = await seedCacheDir(`${PACKAGE_NAME}@9.9.9`);
    const foreign = await seedCacheDir("opencode-architect");
    const foreignNested = await seedCacheDir(`opencode-architect@${PACKAGE_NAME}@latest`);

    const outcome = await clearPackageCache();

    expect(await exists(bare)).toBe(false);
    expect(await exists(latest)).toBe(false);
    expect(await exists(pinned)).toBe(false);
    expect(await exists(otherVersion)).toBe(false);
    expect(await exists(foreign)).toBe(true);
    expect(await exists(foreignNested)).toBe(true);
    expect(outcome.removed).toEqual(
      [bare, latest, pinned, otherVersion].sort()
    );
    expect(outcome.warnings).toEqual([]);
  });

  test("is idempotent when nothing is cached", async () => {
    await useSandboxedCache();
    const outcome = await clearPackageCache();
    expect(outcome.removed).toEqual([]);
    expect(outcome.warnings).toEqual([]);
  });
});

describe("prunePackageCache (exact self-copies)", () => {
  test("removes only bare, @latest, and current-version copies", async () => {
    await useSandboxedCache();
    const bare = await seedCacheDir(PACKAGE_NAME);
    const latest = await seedCacheDir(`${PACKAGE_NAME}@latest`);
    const current = await seedCacheDir(`${PACKAGE_NAME}@${PACKAGE_VERSION}`);
    const oldVersion = await seedCacheDir(`${PACKAGE_NAME}@0.0.1`);
    const foreign = await seedCacheDir("opencode-architect");

    const outcome = await prunePackageCache();

    expect(await exists(bare)).toBe(false);
    expect(await exists(latest)).toBe(false);
    expect(await exists(current)).toBe(false);
    expect(await exists(oldVersion)).toBe(true);
    expect(await exists(foreign)).toBe(true);
    expect(outcome.removed).toEqual([bare, current, latest].sort());
  });

  test("succeeds when the package cache root does not exist", async () => {
    await useSandboxedCache();
    await rm(PACKAGES_ROOT, { recursive: true, force: true });
    const outcome = await prunePackageCache();
    expect(outcome.removed).toEqual([]);
    expect(outcome.warnings).toEqual([]);
  });
});
