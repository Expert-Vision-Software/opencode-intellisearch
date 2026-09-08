import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { RegistrationDetector, type RegistrationContext } from "../../src/registration.ts";
import { snapshotDirectory } from "../helpers/snapshot.ts";
import { SANDBOX_GLOBAL_BASE, resetGlobalConfig, withGlobalSandbox, writeGlobalPluginConfig } from "../helpers/global-sandbox.ts";

const TEST_DIR = join(import.meta.dirname, ".test-registration");
const PACKAGE_NAME = "opencode-intellisearch";

async function makeFixture(name: string): Promise<string> {
  const fixtureDir = join(TEST_DIR, name);
  await rm(fixtureDir, { recursive: true, force: true });
  await mkdir(fixtureDir, { recursive: true });
  return fixtureDir;
}

async function writeNestedRepoConfig(fixtureDir: string, plugin: string[]): Promise<void> {
  const localDir = join(fixtureDir, ".opencode");
  await mkdir(localDir, { recursive: true });
  await writeFile(
    join(localDir, "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin }, null, 2)
  );
}

async function writeRootRepoConfig(fixtureDir: string, plugin: string[]): Promise<void> {
  await writeFile(
    join(fixtureDir, "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin }, null, 2)
  );
}

async function expectContext(fixtureDir: string, expected: RegistrationContext): Promise<void> {
  expect(await RegistrationDetector.detect(fixtureDir)).toBe(expected);
}

describe("RegistrationDetector.detect", () => {
  test("returns none when nothing registers the package anywhere", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      const fixtureDir = await makeFixture("none");
      await expectContext(fixtureDir, "none");
    });
  });

  test("returns global for a bare-name global registration", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      await writeGlobalPluginConfig([PACKAGE_NAME]);
      const fixtureDir = await makeFixture("global-bare");
      await expectContext(fixtureDir, "global");
    });
  });

  test("returns global for a name@latest global registration", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      await writeGlobalPluginConfig([`${PACKAGE_NAME}@latest`]);
      const fixtureDir = await makeFixture("global-latest");
      await expectContext(fixtureDir, "global");
    });
  });

  test("returns global for a pinned name@x.y.z global registration", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      await writeGlobalPluginConfig([`${PACKAGE_NAME}@0.1.0`]);
      const fixtureDir = await makeFixture("global-pinned");
      await expectContext(fixtureDir, "global");
    });
  });

  test("returns repo-local for a nested .opencode/opencode.json registration", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      const fixtureDir = await makeFixture("repo-nested");
      await writeNestedRepoConfig(fixtureDir, [PACKAGE_NAME]);
      await expectContext(fixtureDir, "repo-local");
    });
  });

  test("returns repo-local for a repo-root opencode.json registration", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      const fixtureDir = await makeFixture("repo-root");
      await writeRootRepoConfig(fixtureDir, [`${PACKAGE_NAME}@latest`]);
      await expectContext(fixtureDir, "repo-local");
    });
  });

  test("returns repo-local when a foreign plugin occupies the global registration", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      await writeGlobalPluginConfig(["opencode-architect"]);
      const fixtureDir = await makeFixture("repo-with-foreign-global");
      await writeNestedRepoConfig(fixtureDir, [PACKAGE_NAME]);
      await expectContext(fixtureDir, "repo-local");
    });
  });

  test("returns both when both scopes register the package", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      await writeGlobalPluginConfig([PACKAGE_NAME]);
      const fixtureDir = await makeFixture("both");
      await writeRootRepoConfig(fixtureDir, [PACKAGE_NAME]);
      await expectContext(fixtureDir, "both");
    });
  });

  test("detection performs zero disk writes", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      await writeGlobalPluginConfig([PACKAGE_NAME]);
      const fixtureDir = await makeFixture("zero-write");
      await writeNestedRepoConfig(fixtureDir, [PACKAGE_NAME]);
      const before = await snapshotDirectory(fixtureDir);
      const beforeGlobal = await snapshotDirectory(SANDBOX_GLOBAL_BASE);

      await RegistrationDetector.detect(fixtureDir);

      expect(await snapshotDirectory(fixtureDir)).toEqual(before);
      expect(await snapshotDirectory(SANDBOX_GLOBAL_BASE)).toEqual(beforeGlobal);
    });
  });
});

describe("RegistrationDetector.scopesToEnsure", () => {
  test("maps each context to its managed scopes", () => {
    expect(RegistrationDetector.scopesToEnsure("none")).toEqual([]);
    expect(RegistrationDetector.scopesToEnsure("global")).toEqual(["global"]);
    expect(RegistrationDetector.scopesToEnsure("repo-local")).toEqual(["local"]);
    expect(RegistrationDetector.scopesToEnsure("both")).toEqual(["global", "local"]);
  });
});

describe("RegistrationDetector.hasAnyInstallation", () => {
  test("returns false when nothing is installed in any scope", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      const fixtureDir = await makeFixture("install-none");
      expect(await RegistrationDetector.hasAnyInstallation(fixtureDir)).toBe(false);
    });
  });

  test("returns true when the global scope holds an install", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      const skillDir = join(SANDBOX_GLOBAL_BASE, "skills", "intellisearch");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "---\nname: intellisearch\n---\n");
      const fixtureDir = await makeFixture("install-global");
      expect(await RegistrationDetector.hasAnyInstallation(fixtureDir)).toBe(true);
    });
  });

  test("returns true when only the repo scope holds an install", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      const fixtureDir = await makeFixture("install-repo");
      const legacySkillDir = join(fixtureDir, ".opencode", "skills", "intellisearch");
      await mkdir(legacySkillDir, { recursive: true });
      await writeFile(join(legacySkillDir, ".version"), "0.1.0");
      expect(await RegistrationDetector.hasAnyInstallation(fixtureDir)).toBe(true);
    });
  });
});
