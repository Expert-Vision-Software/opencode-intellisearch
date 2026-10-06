import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { exists, mkdir, rm, readFile, writeFile } from "node:fs/promises";
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

async function invokeConfigHook(fixtureDir: string, input: Record<string, unknown> = {}): Promise<void> {
  // @ts-ignore - PluginInput requires full context, we only need directory
  const pluginResult = await plugin({ directory: fixtureDir });
  // @ts-ignore - config returns async function that takes Config argument
  await (pluginResult.config as ((input: unknown) => Promise<void>) | undefined)?.(input);
}

async function expectNoSkillPermissions(input: Record<string, unknown>): Promise<void> {
  expect(input["permission"]).toBeUndefined();
}

describe("IntelliSearchPlugin", () => {
  test("plugin returns config function", async () => {
    // @ts-ignore - PluginInput requires full context, we only need directory
    const result = await plugin({ directory: TEST_DIR });
    expect(result.config).toBeDefined();
    expect(typeof result.config).toBe("function");
  });

  test("does not inject skill permissions in memory (CLI-only configuration)", async () => {
    const input = {} as Record<string, unknown>;
    await invokeConfigHook(TEST_DIR, input);
    await expectNoSkillPermissions(input);
  });

  test("unregistered repo with nothing installed: config hook performs zero disk writes", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      const fixtureDir = await makeFixture("zero-write-repo");

      const before = await snapshotDirectory(fixtureDir);
      await invokeConfigHook(fixtureDir);
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

      const input = {} as Record<string, unknown>;
      await invokeConfigHook(fixtureDir, input);

      expect(await readFile(configPath, "utf-8")).toBe(configContent);
      expect(await exists(join(fixtureDir, ".opencode", "skills", "intellisearch", "SKILL.md"))).toBe(true);
      expect(await exists(join(fixtureDir, ".opencode", "commands", "search-intelligently.md"))).toBe(true);
      expect(await exists(join(fixtureDir, ".opencode", `${PACKAGE_NAME}.manifest.json`))).toBe(true);
      expect(input["model"]).toBe("some/model");
      await expectNoSkillPermissions(input);
    });
  });

  test("global registration: writes land only under the global config dir, repo untouched", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      await writeGlobalPluginConfig([PACKAGE_NAME]);
      const fixtureDir = await makeFixture("global-context-fresh");
      const repoBefore = await snapshotDirectory(fixtureDir);

      await invokeConfigHook(fixtureDir);

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

      await invokeConfigHook(fixtureDir);
      const globalBefore = await snapshotDirectory(SANDBOX_GLOBAL_BASE);
      const repoBefore = await snapshotDirectory(fixtureDir);

      await invokeConfigHook(fixtureDir);

      expect(await snapshotDirectory(SANDBOX_GLOBAL_BASE)).toEqual(globalBefore);
      expect(await snapshotDirectory(fixtureDir)).toEqual(repoBefore);
    });
  });

  test("global registration version drift: updates the global scope only", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      await writeGlobalPluginConfig([PACKAGE_NAME]);
      const fixtureDir = await makeFixture("global-context-drift");

      await invokeConfigHook(fixtureDir);
      const manifestPath = join(SANDBOX_GLOBAL_BASE, `${PACKAGE_NAME}.manifest.json`);
      const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as { version: string };
      manifest.version = "0.0.1";
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      const repoBefore = await snapshotDirectory(fixtureDir);

      await invokeConfigHook(fixtureDir);

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

      await invokeConfigHook(fixtureDir);

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

      await invokeConfigHook(fixtureDir);

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

      await invokeConfigHook(fixtureDir);

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

      await invokeConfigHook(fixtureDir);

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
      await invokeConfigHook(fixtureDir);
      const manifestPath = join(localDir, `${PACKAGE_NAME}.manifest.json`);
      const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as { version: string };
      manifest.version = "0.0.1";
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      await invokeConfigHook(fixtureDir);

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

      await invokeConfigHook(fixtureDir);

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

      await invokeConfigHook(fixtureDir);

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

      const input = {} as Record<string, unknown>;
      await invokeConfigHook(fixtureDir, input);

      expect(await readFile(join(localDir, "opencode.json"), "utf-8")).toBe(configContent);
      expect(input["model"]).toBe("some/model");
      expect(input["$schema"]).toBe("https://opencode.ai/config.json");
      expect(input["plugin"]).toBeUndefined();
      await expectNoSkillPermissions(input);
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
        await invokeConfigHook(fixtureDir);
        const after = await snapshotDirectory(fixtureDir);

        expect(after).toEqual(before);
      });
    });
  }

  test("scenario E control performs zero writes and injects no permissions", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      const fixtureDir = join(scenariosDir, "E-control-repo-up-to-date-local");
      const input = {} as Record<string, unknown>;
      await invokeConfigHook(fixtureDir, input);
      await expectNoSkillPermissions(input);
    });
  });
});

interface CapturedAdvisory {
  logs: Array<{ body?: { service?: string; level?: string; message?: string } }>;
  toasts: Array<{ body?: { title?: string; message?: string; variant?: string; duration?: number } }>;
}

function makeCapturingClient(): { client: unknown; captured: CapturedAdvisory } {
  const captured: CapturedAdvisory = { logs: [], toasts: [] };
  const client = {
    app: {
      log: async (input: { body: { service: string; level: string; message: string } }) => {
        captured.logs.push(input);
      },
    },
    tui: {
      showToast: async (input: { body: { title: string; message: string; variant: string; duration: number } }) => {
        captured.toasts.push(input);
      },
    },
  };
  return { client, captured };
}

async function invokeConfigHookWithClient(
  fixtureDir: string,
  client: unknown,
  input: Record<string, unknown> = {}
): Promise<void> {
  // @ts-ignore - PluginInput requires full context, we only need directory and client
  const pluginResult = await plugin({ directory: fixtureDir, client });
  // @ts-ignore - config returns async function that takes Config argument
  await (pluginResult.config as ((input: unknown) => Promise<void>) | undefined)?.(input);
}

describe("install advisory (one-shot)", () => {
  test("nothing installed anywhere: emits exactly one warn log and one warning toast, zero writes", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      const fixtureDir = await makeFixture("advisory-fires");
      const { client, captured } = makeCapturingClient();
      const before = await snapshotDirectory(fixtureDir);

      await invokeConfigHookWithClient(fixtureDir, client);

      expect(await snapshotDirectory(fixtureDir)).toEqual(before);
      expect(captured.logs.length).toBe(1);
      expect(captured.logs[0]?.body?.service).toBe(PACKAGE_NAME);
      expect(captured.logs[0]?.body?.level).toBe("warn");
      expect(captured.logs[0]?.body?.message).toContain("bunx opencode-intellisearch install --scope global");
      expect(captured.toasts.length).toBe(1);
      expect(captured.toasts[0]?.body?.variant).toBe("warning");
      expect(captured.toasts[0]?.body?.message).toContain("bunx opencode-intellisearch install --scope global");
    });
  });

  test("the advisory fires at most once per plugin session", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      const fixtureDir = await makeFixture("advisory-once-per-session");
      const { client, captured } = makeCapturingClient();

      // @ts-ignore - PluginInput requires full context, we only need directory and client
      const pluginResult = await plugin({ directory: fixtureDir, client });
      const config = pluginResult.config as ((input: unknown) => Promise<void>) | undefined;
      await config?.({});
      await config?.({});
      await config?.({});

      expect(captured.logs.length).toBe(1);
      expect(captured.toasts.length).toBe(1);
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
        JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: ["opencode-architect"] }, null, 2)
      );
      await install("local", fixtureDir, { mode: "plugin", addPluginConfig: false, migrateRootConfig: false, force: false, configurePermission: false, configureMcp: false });

      const { client, captured } = makeCapturingClient();
      const before = await snapshotDirectory(fixtureDir);
      await invokeConfigHookWithClient(fixtureDir, client);

      expect(captured.logs.length).toBe(0);
      expect(captured.toasts.length).toBe(0);
      expect(await snapshotDirectory(fixtureDir)).toEqual(before);
    });
  });
});

describe("failure advisory (one-shot, independent of the not-installed advisory)", () => {
  function failureLogs(captured: CapturedAdvisory): Array<{ body?: { message?: string } }> {
    return captured.logs.filter(log => (log.body?.message ?? "").includes("clear-cache"));
  }

  async function setupFailingGlobalScope(): Promise<void> {
    await resetGlobalConfig();
    await writeGlobalPluginConfig([PACKAGE_NAME]);
    await writeFile(join(SANDBOX_GLOBAL_BASE, "skills"), "not a directory");
  }

  test("a failing ensure emits exactly one failure advisory naming the remediation command and cache dir", async () => {
    await withGlobalSandbox(async () => {
      await setupFailingGlobalScope();
      const fixtureDir = await makeFixture("failure-advisory-fires");
      const { client, captured } = makeCapturingClient();

      // @ts-ignore - PluginInput requires full context, we only need directory and client
      const pluginResult = await plugin({ directory: fixtureDir, client });
      const config = pluginResult.config as ((input: unknown) => Promise<void>) | undefined;
      await config?.({});

      expect(failureLogs(captured).length).toBe(1);
      const message = failureLogs(captured)[0]?.body?.message ?? "";
      expect(message).toContain("bunx opencode-intellisearch clear-cache");
      expect(message).toContain("bunx opencode-intellisearch install --scope global");
      expect(message).toContain(`~/.cache/opencode/packages/${PACKAGE_NAME}@`);
      expect(captured.toasts.length).toBe(1);
      expect(captured.toasts[0]?.body?.message).toContain("clear-cache");
    });
  });

  test("repeated failing config hook invocations emit exactly one failure advisory", async () => {
    await withGlobalSandbox(async () => {
      await setupFailingGlobalScope();
      const fixtureDir = await makeFixture("failure-advisory-once");
      const { client, captured } = makeCapturingClient();

      // @ts-ignore - PluginInput requires full context, we only need directory and client
      const pluginResult = await plugin({ directory: fixtureDir, client });
      const config = pluginResult.config as ((input: unknown) => Promise<void>) | undefined;
      await config?.({});
      await config?.({});
      await config?.({});

      expect(failureLogs(captured).length).toBe(1);
      expect(captured.toasts.length).toBe(1);
    });
  });

  test("the not-installed advisory still fires independently in a later session", async () => {
    await withGlobalSandbox(async () => {
      await resetGlobalConfig();
      const fixtureDir = await makeFixture("failure-then-d5");
      const { client, captured } = makeCapturingClient();

      await invokeConfigHookWithClient(fixtureDir, client);

      expect(failureLogs(captured).length).toBe(0);
      expect(captured.logs.length).toBe(1);
      expect(captured.logs[0]?.body?.message).toContain("bunx opencode-intellisearch install --scope global");
    });
  });
});
