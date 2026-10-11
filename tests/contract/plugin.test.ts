import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { exists, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { Effect } from "effect";
import plugin from "../../src/plugin.ts";
import { install } from "../../src/installer.ts";
import { snapshotDirectory } from "../helpers/snapshot.ts";
import {
  SANDBOX_GLOBAL_BASE,
  resetGlobalConfig,
  withGlobalSandbox,
  writeGlobalPluginConfig,
} from "../helpers/global-sandbox.ts";

const TEST_DIR = join(import.meta.dirname, ".test-temp");
const PACKAGE_NAME = "opencode-intellisearch";

beforeAll(async () => {
  await rm(TEST_DIR, { recursive: true }).catch(() => {});
  await mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true });
});

async function makeFixture(name: string): Promise<string> {
  const fixtureDir = join(TEST_DIR, name);
  await rm(fixtureDir, { recursive: true, force: true });
  await mkdir(fixtureDir, { recursive: true });
  return fixtureDir;
}

type PluginContext = Parameters<typeof plugin.effect>[0];

async function runStartup(fixtureDir: string): Promise<void> {
  const context = { location: { directory: fixtureDir } } as unknown as PluginContext;
  await Effect.runPromise(plugin.effect(context));
}

async function withCapturedWarns(fn: (warns: string[]) => Promise<void>): Promise<void> {
  const warns: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args.map(String).join(" "));
  };
  try {
    await fn(warns);
  } finally {
    console.warn = original;
  }
}

describe("IntelliSearchPlugin", () => {
  test("v2 plugin shape: defines an id and an effect", () => {
    expect(plugin.id).toBe(PACKAGE_NAME);
    expect(typeof plugin.effect).toBe("function");
  });

  test("does not mutate any config (CLI-only configuration)", async () => {
    const before = await snapshotDirectory(TEST_DIR);
    await runStartup(TEST_DIR);
    expect(await snapshotDirectory(TEST_DIR)).toEqual(before);
  });

  test("unregistered repo with nothing installed: config hook performs zero disk writes", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      const fixtureDir = await makeFixture("zero-write-repo");

      const before = await snapshotDirectory(fixtureDir);
      await runStartup(fixtureDir);
      const after = await snapshotDirectory(fixtureDir);

      expect(after).toEqual(before);
      expect(Object.keys(after)).toEqual([]);
      expect(await exists(SANDBOX_GLOBAL_BASE)).toBe(false);
    });
  });

  test("repo-local registration: ensures repo assets and preserves the config file byte-for-byte", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      const fixtureDir = await makeFixture("repo-local-ensure");
      const configPath = join(fixtureDir, ".opencode", "opencode.json");
      await mkdir(join(fixtureDir, ".opencode"), { recursive: true });
      const configContent = JSON.stringify(
        { $schema: "https://opencode.ai/config.json", model: "some/model", plugin: [PACKAGE_NAME] },
        null,
        2
      );
      await writeFile(configPath, configContent);

      await runStartup(fixtureDir);

      expect(await readFile(configPath, "utf-8")).toBe(configContent);
      expect(await exists(join(fixtureDir, ".opencode", "skills", "intellisearch", "SKILL.md"))).toBe(true);
      expect(await exists(join(fixtureDir, ".opencode", "commands", "search-intelligently.md"))).toBe(true);
      expect(await exists(join(fixtureDir, ".opencode", `${PACKAGE_NAME}.manifest.json`))).toBe(true);
    });
  });

  test("global registration: writes land only under the global config dir, repo untouched", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      await writeGlobalPluginConfig([PACKAGE_NAME]);
      const fixtureDir = await makeFixture("global-context-fresh");
      const repoBefore = await snapshotDirectory(fixtureDir);

      await runStartup(fixtureDir);

      expect(await snapshotDirectory(fixtureDir)).toEqual(repoBefore);
      expect(await exists(join(SANDBOX_GLOBAL_BASE, `${PACKAGE_NAME}.manifest.json`))).toBe(true);
      expect(await exists(join(SANDBOX_GLOBAL_BASE, "skills", "intellisearch", "SKILL.md"))).toBe(true);
      expect(await exists(join(SANDBOX_GLOBAL_BASE, "commands", "search-intelligently.md"))).toBe(true);
    });
  });

  test("global registration steady state: second load is a zero-write no-op", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      await writeGlobalPluginConfig([PACKAGE_NAME]);
      const fixtureDir = await makeFixture("global-context-steady");

      await runStartup(fixtureDir);
      const globalBefore = await snapshotDirectory(SANDBOX_GLOBAL_BASE);
      const repoBefore = await snapshotDirectory(fixtureDir);

      await runStartup(fixtureDir);

      expect(await snapshotDirectory(SANDBOX_GLOBAL_BASE)).toEqual(globalBefore);
      expect(await snapshotDirectory(fixtureDir)).toEqual(repoBefore);
    });
  });

  test("global registration version drift: updates the global scope only", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      await writeGlobalPluginConfig([PACKAGE_NAME]);
      const fixtureDir = await makeFixture("global-context-drift");

      await runStartup(fixtureDir);
      const manifestPath = join(SANDBOX_GLOBAL_BASE, `${PACKAGE_NAME}.manifest.json`);
      const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as { version: string };
      manifest.version = "0.0.1";
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      const repoBefore = await snapshotDirectory(fixtureDir);

      await runStartup(fixtureDir);

      const rewritten = JSON.parse(await readFile(manifestPath, "utf-8")) as { version: string };
      expect(rewritten.version).not.toBe("0.0.1");
      expect(await snapshotDirectory(fixtureDir)).toEqual(repoBefore);
    });
  });

  test("repo-root opencode.json registration: root file never touched, assets under .opencode", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      const fixtureDir = await makeFixture("repo-root-registration");
      const rootConfigPath = join(fixtureDir, "opencode.json");
      const rootContent = JSON.stringify(
        { $schema: "https://opencode.ai/config.json", model: "some/model", plugin: [PACKAGE_NAME] },
        null,
        2
      );
      await writeFile(rootConfigPath, rootContent);

      await runStartup(fixtureDir);

      expect(await readFile(rootConfigPath, "utf-8")).toBe(rootContent);
      expect(await exists(join(fixtureDir, ".opencode", `${PACKAGE_NAME}.manifest.json`))).toBe(true);
      expect(await exists(join(fixtureDir, ".opencode", "skills", "intellisearch", "SKILL.md"))).toBe(true);
      expect(await exists(join(fixtureDir, ".opencode", "opencode.json"))).toBe(false);
    });
  });

  test("repo-root registration with a foreign plugin while globally registered: global ensured, root untouched", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      await writeGlobalPluginConfig([PACKAGE_NAME]);
      const fixtureDir = await makeFixture("global-context-root-foreign");
      const rootConfigPath = join(fixtureDir, "opencode.json");
      const rootContent = JSON.stringify(
        { $schema: "https://opencode.ai/config.json", plugin: ["opencode-architect"] },
        null,
        2
      );
      await writeFile(rootConfigPath, rootContent);
      const repoBefore = await snapshotDirectory(fixtureDir);

      await runStartup(fixtureDir);

      expect(await readFile(rootConfigPath, "utf-8")).toBe(rootContent);
      expect(await snapshotDirectory(fixtureDir)).toEqual(repoBefore);
      expect(await exists(join(SANDBOX_GLOBAL_BASE, `${PACKAGE_NAME}.manifest.json`))).toBe(true);
    });
  });

  test("repo-local registration with an unparseable nested config: assets ensured, invalid file preserved", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      const fixtureDir = await makeFixture("repo-local-invalid-config");
      const rootConfigPath = join(fixtureDir, "opencode.json");
      await writeFile(
        rootConfigPath,
        JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: [PACKAGE_NAME] }, null, 2)
      );
      const localDir = join(fixtureDir, ".opencode");
      await mkdir(localDir, { recursive: true });
      const invalidContent =
        '{\n  "$schema": "https://opencode.ai/config.json",\n  "plugin": [\n    "opencode-architect"\n  ],\n}';
      const invalidPath = join(localDir, "opencode.json");
      await writeFile(invalidPath, invalidContent);

      await runStartup(fixtureDir);

      expect(await readFile(invalidPath, "utf-8")).toBe(invalidContent);
      expect(await exists(join(localDir, "skills", "intellisearch", "SKILL.md"))).toBe(true);
      expect(await exists(join(localDir, `${PACKAGE_NAME}.manifest.json`))).toBe(true);
    });
  });

  test("both scopes registered: both ensured with no cross-scope leakage", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      await writeGlobalPluginConfig([PACKAGE_NAME]);
      const fixtureDir = await makeFixture("both-scopes");
      const localDir = join(fixtureDir, ".opencode");
      await mkdir(localDir, { recursive: true });
      await writeFile(
        join(localDir, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: [PACKAGE_NAME] }, null, 2)
      );

      await runStartup(fixtureDir);

      expect(await exists(join(SANDBOX_GLOBAL_BASE, `${PACKAGE_NAME}.manifest.json`))).toBe(true);
      expect(await exists(join(SANDBOX_GLOBAL_BASE, "skills", "intellisearch", "SKILL.md"))).toBe(true);
      expect(await exists(join(localDir, `${PACKAGE_NAME}.manifest.json`))).toBe(true);
      expect(await exists(join(localDir, "skills", "intellisearch", "SKILL.md"))).toBe(true);
      const globalConfig = JSON.parse(
        await readFile(join(SANDBOX_GLOBAL_BASE, "opencode.json"), "utf-8")
      ) as Record<string, unknown>;
      expect(globalConfig["plugin"]).toEqual([PACKAGE_NAME]);
    });
  });

  test("repo-local version drift: updates the repo scope only, global untouched", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      const fixtureDir = await makeFixture("repo-local-drift");
      const localDir = join(fixtureDir, ".opencode");
      await mkdir(localDir, { recursive: true });
      await writeFile(
        join(localDir, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: [PACKAGE_NAME] }, null, 2)
      );
      await runStartup(fixtureDir);
      const manifestPath = join(localDir, `${PACKAGE_NAME}.manifest.json`);
      const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as { version: string };
      manifest.version = "0.0.1";
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      await runStartup(fixtureDir);

      const rewritten = JSON.parse(await readFile(manifestPath, "utf-8")) as { version: string };
      expect(rewritten.version).not.toBe("0.0.1");
      expect(await exists(SANDBOX_GLOBAL_BASE)).toBe(false);
    });
  });

  test("global context with a valid local config lacking our plugin entry: zero repo writes", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      await writeGlobalPluginConfig([PACKAGE_NAME]);
      const fixtureDir = await makeFixture("global-context-local-config");
      const localDir = join(fixtureDir, ".opencode");
      await mkdir(localDir, { recursive: true });
      const configContent = JSON.stringify(
        { $schema: "https://opencode.ai/config.json", plugin: ["opencode-architect"] },
        null,
        2
      );
      await writeFile(join(localDir, "opencode.json"), configContent);

      await runStartup(fixtureDir);

      expect(await readFile(join(localDir, "opencode.json"), "utf-8")).toBe(configContent);
      expect(await exists(join(localDir, "skills"))).toBe(false);
      expect(await exists(join(localDir, `${PACKAGE_NAME}.manifest.json`))).toBe(false);
    });
  });

  test("global context with an unparseable local config: zero repo writes, file preserved", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      await writeGlobalPluginConfig([PACKAGE_NAME]);
      const fixtureDir = await makeFixture("global-context-invalid-local");
      const localDir = join(fixtureDir, ".opencode");
      await mkdir(localDir, { recursive: true });
      const invalidContent =
        '{\n  "$schema": "https://opencode.ai/config.json",\n  "plugin": [\n    "opencode-architect"\n  ],\n}';
      await writeFile(join(localDir, "opencode.json"), invalidContent);

      await runStartup(fixtureDir);

      expect(await readFile(join(localDir, "opencode.json"), "utf-8")).toBe(invalidContent);
      expect(await exists(join(localDir, "skills"))).toBe(false);
    });
  });

  test("merges non-plugin local overrides in memory only", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      const fixtureDir = await makeFixture("merge-overrides-repo");
      const localDir = join(fixtureDir, ".opencode");
      await mkdir(localDir, { recursive: true });
      const configContent = JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          model: "some/model",
          plugin: ["opencode-architect"],
        },
        null,
        2
      );
      await writeFile(join(localDir, "opencode.json"), configContent);

      await runStartup(fixtureDir);

      expect(await readFile(join(localDir, "opencode.json"), "utf-8")).toBe(configContent);
    });
  });
});

interface ReproScenario {
  name: string;
  setup: (dir: string) => Promise<void>;
}

const REPRO_SCENARIOS: ReproScenario[] = [
  { name: "A-fresh-repo-no-config", setup: async () => {} },
  {
    name: "B-repo-with-root-opencode-json",
    setup: async dir => {
      await writeFile(
        join(dir, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json", model: "some/model" }, null, 2)
      );
    },
  },
  {
    name: "C-repo-valid-local-config-without-plugin",
    setup: async dir => {
      const localDir = join(dir, ".opencode");
      await mkdir(localDir, { recursive: true });
      await writeFile(
        join(localDir, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: ["opencode-architect"] }, null, 2)
      );
    },
  },
  {
    name: "D-repo-invalid-local-config-trailing-comma",
    setup: async dir => {
      const localDir = join(dir, ".opencode");
      await mkdir(localDir, { recursive: true });
      await writeFile(
        join(localDir, "opencode.json"),
        '{\n  "$schema": "https://opencode.ai/config.json",\n  "plugin": [\n    "opencode-architect"\n  ],\n}'
      );
    },
  },
  {
    name: "E-control-repo-up-to-date-local",
    setup: async dir => {
      const localDir = join(dir, ".opencode");
      await mkdir(localDir, { recursive: true });
      await writeFile(
        join(localDir, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: ["opencode-intellisearch"] }, null, 2)
      );
      await install("local", dir, { mode: "plugin", addPluginConfig: false, migrateRootConfig: false, force: false, configurePermission: false, configureMcp: false });
    },
  },
];

describe("config hook repro scenarios ported from qcgates-repro", () => {
  const scenariosDir = join(import.meta.dirname, ".test-scenarios");

  beforeAll(async () => {
    await rm(scenariosDir, { recursive: true, force: true });
    await mkdir(scenariosDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(scenariosDir, { recursive: true, force: true });
  });

  for (const scenario of REPRO_SCENARIOS) {
    test(`scenario ${scenario.name} produces zero repo disk writes from the config hook`, async () => {
      await withGlobalSandbox(async () => {
        await resetGlobalConfig();
        const fixtureDir = join(scenariosDir, scenario.name);
        await mkdir(fixtureDir, { recursive: true });
        await scenario.setup(fixtureDir);

        const before = await snapshotDirectory(fixtureDir);
        await runStartup(fixtureDir);
        const after = await snapshotDirectory(fixtureDir);

        expect(after).toEqual(before);
      });
    });
  }

  test("scenario E control performs zero writes", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      const fixtureDir = join(scenariosDir, "E-control-repo-up-to-date-local");
      await runStartup(fixtureDir);
    });
  });
});

describe("install advisory (one-shot)", () => {
  test("nothing installed anywhere: emits exactly one warn, zero writes", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      const fixtureDir = await makeFixture("advisory-fires");
      const before = await snapshotDirectory(fixtureDir);

      await withCapturedWarns(async (warns) => {
        await runStartup(fixtureDir);

        expect(await snapshotDirectory(fixtureDir)).toEqual(before);
        expect(warns.length).toBe(1);
        expect(warns[0]).toContain(PACKAGE_NAME);
        expect(warns[0]).toContain("bunx opencode-intellisearch install --scope global");
      });
    });
  });

  test("the advisory fires at most once per plugin session", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      const fixtureDir = await makeFixture("advisory-once-per-session");

      await withCapturedWarns(async (warns) => {
        await runStartup(fixtureDir);
        await runStartup(fixtureDir);
        await runStartup(fixtureDir);

        expect(warns.length).toBe(3);
        expect(new Set(warns).size).toBe(1);
      });
    });
  });

  test("an installed scope present: no advisory even when the plugin is unregistered", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      const fixtureDir = await makeFixture("advisory-suppressed");
      const localDir = join(fixtureDir, ".opencode");
      await mkdir(localDir, { recursive: true });
      await writeFile(
        join(localDir, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json", plugins: ["opencode-architect"] }, null, 2)
      );
      await install("local", fixtureDir, { mode: "plugin", addPluginConfig: false, migrateRootConfig: false, force: false, configurePermission: false, configureMcp: false });

      const before = await snapshotDirectory(fixtureDir);
      await withCapturedWarns(async (warns) => {
        await runStartup(fixtureDir);
        expect(warns.length).toBe(0);
      });
      expect(await snapshotDirectory(fixtureDir)).toEqual(before);
    });
  });
});

describe("failure advisory (one-shot, independent of the not-installed advisory)", () => {
  function failureWarns(warns: string[]): string[] {
    return warns.filter((message) => message.includes("clear-cache"));
  }

  async function setupFailingGlobalScope(): Promise<void> {
    await resetGlobalConfig();
    await writeGlobalPluginConfig([PACKAGE_NAME]);
    await writeFile(join(SANDBOX_GLOBAL_BASE, "skills"), "not a directory");
  }

  test("a failing ensure emits exactly one failure warning naming the remediation command and cache dir", async () => {
    await withGlobalSandbox(async () => {
      await setupFailingGlobalScope();
      const fixtureDir = await makeFixture("failure-advisory-fires");

      await withCapturedWarns(async (warns) => {
        await runStartup(fixtureDir);

        expect(failureWarns(warns).length).toBe(1);
        const message = failureWarns(warns)[0] ?? "";
        expect(message).toContain("bunx opencode-intellisearch clear-cache");
        expect(message).toContain("bunx opencode-intellisearch install --scope global");
        expect(message).toContain(`~/.cache/opencode/packages/${PACKAGE_NAME}@`);
      });
    });
  });

  test("repeated failing sessions emit at most one failure warning per session", async () => {
    await withGlobalSandbox(async () => {
      await setupFailingGlobalScope();
      const fixtureDir = await makeFixture("failure-advisory-once");

      await withCapturedWarns(async (warns) => {
        await runStartup(fixtureDir);
        await runStartup(fixtureDir);
        await runStartup(fixtureDir);

        expect(failureWarns(warns).length).toBe(3);
      });
    });
  });

  test("the not-installed advisory still fires independently in a later session", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      const fixtureDir = await makeFixture("failure-then-d5");

      await withCapturedWarns(async (warns) => {
        await runStartup(fixtureDir);

        expect(failureWarns(warns).length).toBe(0);
        expect(warns.length).toBe(1);
        expect(warns[0]).toContain("bunx opencode-intellisearch install --scope global");
      });
    });
  });
});
