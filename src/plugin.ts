import type { Config, Plugin, PluginInput } from "@opencode-ai/plugin";
import {
  ensureAssets,
  getPackageVersion,
  mergeConfigWithOverrides,
  readLocalConfig,
  type Scope,
} from "./installer.ts";
import { RegistrationDetector } from "./registration.ts";

const PLUGIN_SERVICE_NAME = "opencode-intellisearch";
const ADVISORY_TOAST_DURATION_MS = 10000;
const INSTALL_ADVISORY_MESSAGE = `${PLUGIN_SERVICE_NAME} is not installed in any scope. Run "bunx ${PLUGIN_SERVICE_NAME} install --scope global" to enable the intelligent search skill and command.`;
const FAILURE_ADVISORY_FALLBACK_MESSAGE =
  `${PLUGIN_SERVICE_NAME} load-time asset install failed. ` +
  `Run "bunx ${PLUGIN_SERVICE_NAME} clear-cache", then "bunx ${PLUGIN_SERVICE_NAME} install --scope global". ` +
  `Stale cache copies live under ~/.cache/opencode/packages/${PLUGIN_SERVICE_NAME}@<version>.`;

type PluginClient = PluginInput["client"] | undefined;

interface AdvisoryState {
  installAdvised: boolean;
  failureAdvised: boolean;
}

async function readPackageVersionForAdvisory(): Promise<string> {
  try {
    return await getPackageVersion();
  } catch {
    return "<version>";
  }
}

function buildFailureAdvisoryMessage(version: string, cause: string): string {
  return (
    `${PLUGIN_SERVICE_NAME} load-time asset install failed. ` +
    `Run "bunx ${PLUGIN_SERVICE_NAME} clear-cache", then "bunx ${PLUGIN_SERVICE_NAME} install --scope global". ` +
    `Stale cache copies live under ~/.cache/opencode/packages/${PLUGIN_SERVICE_NAME}@${version}. ` +
    `Cause: ${cause}`
  );
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

async function adviseFailureOnce(state: AdvisoryState, client: PluginClient, cause: string): Promise<void> {
  if (state.failureAdvised) {
    return;
  }
  state.failureAdvised = true;
  let message = FAILURE_ADVISORY_FALLBACK_MESSAGE;
  try {
    message = buildFailureAdvisoryMessage(await readPackageVersionForAdvisory(), cause);
  } catch {
    message = FAILURE_ADVISORY_FALLBACK_MESSAGE;
  }
  try {
    await logWarn(client, message);
  } catch {
    return;
  }
  try {
    await showToastAdvisory(client, message);
  } catch {
    return;
  }
}

async function maybeEmitInstallAdvisory(
  state: AdvisoryState,
  client: PluginClient,
  directory: string
): Promise<void> {
  if (state.installAdvised || (await RegistrationDetector.hasAnyInstallation(directory))) {
    return;
  }
  state.installAdvised = true;
  await logWarn(client, INSTALL_ADVISORY_MESSAGE);
  await showToastAdvisory(client, INSTALL_ADVISORY_MESSAGE);
}

async function reportLoadSkippedFiles(client: PluginClient, skippedPaths: string[]): Promise<void> {
  for (const skippedPath of skippedPaths) {
    await logWarn(
      client,
      `Skipped consumer-modified file (re-run "bunx ${PLUGIN_SERVICE_NAME} install --force" to overwrite): ${skippedPath}`
    );
  }
}

async function mergeExistingLocalOverrides(input: Record<string, unknown>, directory: string): Promise<void> {
  const localConfig = await readLocalConfig(directory);
  if (localConfig === null) {
    return;
  }
  mergeConfigWithOverrides(input, localConfig);
}

const plugin: Plugin = async ({ directory, client }) => {
  const advisoryState: AdvisoryState = { installAdvised: false, failureAdvised: false };

  return {
    config: async (input: Config) => {
      try {
        await mergeExistingLocalOverrides(input as Record<string, unknown>, directory);

        const context = await RegistrationDetector.detect(directory);
        const scopes = RegistrationDetector.scopesToEnsure(context);

        if (scopes.length === 0) {
          await maybeEmitInstallAdvisory(advisoryState, client, directory);
          return;
        }

        for (const scope of scopes) {
          const result = await ensureAssets(scope, directory, false);
          await reportLoadSkippedFiles(client, result.skipped);
        }
      } catch (error) {
        await adviseFailureOnce(advisoryState, client, error instanceof Error ? error.message : String(error));
      }
    },
  };
};

export default plugin;
