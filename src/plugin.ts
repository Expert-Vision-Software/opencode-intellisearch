import { Effect } from "effect";
import { Plugin } from "@opencode/plugin/effect";
import { ensureAssets, getPackageVersion } from "./installer.ts";
import { RegistrationDetector } from "./registration.ts";

const PLUGIN_SERVICE_NAME = "opencode-intellisearch";
const INSTALL_ADVISORY_MESSAGE = `${PLUGIN_SERVICE_NAME} is not installed in any scope. Run "bunx ${PLUGIN_SERVICE_NAME} install --scope global" to enable the intelligent search skill and command.`;
const FAILURE_ADVISORY_FALLBACK_MESSAGE =
  `${PLUGIN_SERVICE_NAME} load-time asset install failed. ` +
  `Run "bunx ${PLUGIN_SERVICE_NAME} clear-cache", then "bunx ${PLUGIN_SERVICE_NAME} install --scope global". ` +
  `Stale cache copies live under ~/.cache/opencode/packages/${PLUGIN_SERVICE_NAME}@<version>.`;

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

function logWarn(message: string): void {
  console.warn(`[${PLUGIN_SERVICE_NAME}] ${message}`);
}

async function adviseFailureOnce(state: AdvisoryState, cause: string): Promise<void> {
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
  logWarn(message);
}

async function maybeEmitInstallAdvisory(state: AdvisoryState, directory: string): Promise<void> {
  if (state.installAdvised || (await RegistrationDetector.hasAnyInstallation(directory))) {
    return;
  }
  state.installAdvised = true;
  logWarn(INSTALL_ADVISORY_MESSAGE);
}

async function reportLoadSkippedFiles(skippedPaths: string[]): Promise<void> {
  for (const skippedPath of skippedPaths) {
    logWarn(
      `Skipped consumer-modified file (re-run "bunx ${PLUGIN_SERVICE_NAME} install --force" to overwrite): ${skippedPath}`
    );
  }
}

async function runStartupAssets(directory: string): Promise<void> {
  const advisoryState: AdvisoryState = { installAdvised: false, failureAdvised: false };
  try {
    const context = await RegistrationDetector.detect(directory);
    const scopes = RegistrationDetector.scopesToEnsure(context);

    if (scopes.length === 0) {
      await maybeEmitInstallAdvisory(advisoryState, directory);
      return;
    }

    for (const scope of scopes) {
      const result = await ensureAssets(scope, directory, false);
      await reportLoadSkippedFiles(result.skipped);
    }
  } catch (error) {
    await adviseFailureOnce(advisoryState, error instanceof Error ? error.message : String(error));
  }
}

const plugin = Plugin.define({
  id: PLUGIN_SERVICE_NAME,
  effect: (context) => Effect.promise(() => runStartupAssets(context.location.directory)),
});

export default plugin;
