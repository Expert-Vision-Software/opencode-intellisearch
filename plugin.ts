import type { Plugin, Config, PluginInput } from "@opencode-ai/plugin";
import { install, readLocalConfig, mergeConfigWithOverrides, type Scope, type InstallResult } from "./src/installer.ts";
import { RegistrationDetector } from "./src/registration.ts";

const PLUGIN_SERVICE_NAME = "opencode-intellisearch";
const ADVISORY_TOAST_DURATION_MS = 10000;
const INSTALL_ADVISORY_MESSAGE = `${PLUGIN_SERVICE_NAME} is not installed in any scope. Run "bunx opencode-intellisearch install --scope global" to enable the intelligent search skill and command.`;
const LOAD_INSTALL_OPTIONS = {
  addPluginConfig: false,
  migrateRootConfig: false,
  force: false,
  configurePermission: false,
  configureMcp: false,
};

type PluginClient = PluginInput["client"] | undefined;

interface AdvisoryState {
  emitted: boolean;
}

function setSkillPermission(input: Config): void {
  input.permission ??= {};

  const permission = input.permission as Record<string, unknown>;
  permission.skill ??= {};
  const skillPermissions = permission.skill as Record<string, string>;

  skillPermissions["intellisearch"] = "allow";
}

async function mergeExistingLocalOverrides(input: Record<string, unknown>, directory: string): Promise<void> {
  const localConfig = await readLocalConfig(directory);
  if (localConfig === null) {
    return;
  }
  mergeConfigWithOverrides(input, localConfig);
}

async function logWarn(client: PluginClient, message: string): Promise<void> {
  const log = client?.app?.log;
  if (!log) {
    console.warn(`[${PLUGIN_SERVICE_NAME}] ${message}`);
    return;
  }
  try {
    await log({ body: { service: PLUGIN_SERVICE_NAME, level: "warn", message } });
  } catch {
    console.warn(`[${PLUGIN_SERVICE_NAME}] ${message}`);
  }
}

async function showToastAdvisory(client: PluginClient, message: string): Promise<void> {
  try {
    await client?.tui?.showToast?.({
      body: {
        title: PLUGIN_SERVICE_NAME,
        message,
        variant: "warning",
        duration: ADVISORY_TOAST_DURATION_MS,
      },
    });
  } catch {
    return;
  }
}

async function maybeEmitInstallAdvisory(state: AdvisoryState, client: PluginClient, directory: string): Promise<void> {
  if (state.emitted || (await RegistrationDetector.hasAnyInstallation(directory))) {
    return;
  }
  state.emitted = true;
  await logWarn(client, INSTALL_ADVISORY_MESSAGE);
  await showToastAdvisory(client, INSTALL_ADVISORY_MESSAGE);
}

async function reportLoadSkippedFiles(client: PluginClient, result: InstallResult): Promise<void> {
  for (const skippedPath of result.skipped) {
    await logWarn(
      client,
      `Skipped consumer-modified file (re-run "bunx opencode-intellisearch install --force" to overwrite): ${skippedPath}`
    );
  }
}

async function ensureScopeAssets(client: PluginClient, scope: Scope, directory: string): Promise<InstallResult> {
  const result = await install(scope, directory, LOAD_INSTALL_OPTIONS);
  await reportLoadSkippedFiles(client, result);
  return result;
}

const plugin: Plugin = async ({ directory, client }) => {
  const advisoryState: AdvisoryState = { emitted: false };

  return {
    config: async (input: Config) => {
      setSkillPermission(input);
      await mergeExistingLocalOverrides(input as Record<string, unknown>, directory);

      const context = await RegistrationDetector.detect(directory);
      const scopes = RegistrationDetector.scopesToEnsure(context);

      if (scopes.length === 0) {
        await maybeEmitInstallAdvisory(advisoryState, client, directory);
        return;
      }

      for (const scope of scopes) {
        await ensureScopeAssets(client, scope, directory);
      }
    },
  };
};

export default plugin;
