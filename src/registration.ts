import { join } from "node:path";
import {
  getGlobalConfigPath,
  getLocalConfigPath,
  getPackageName,
  isPluginInConfig,
  isScopeInstalled,
  type Scope,
} from "./installer.ts";

export type RegistrationContext = "none" | "global" | "repo-local" | "both";

export class RegistrationDetector {
  static async detect(directory: string): Promise<RegistrationContext> {
    const packageName = await getPackageName();
    const globalRegistered = await RegistrationDetector.isRegisteredInGlobalBase(packageName);
    const repoLocalRegistered = await RegistrationDetector.isRegisteredInRepo(directory, packageName);

    if (globalRegistered && repoLocalRegistered) {
      return "both";
    }
    if (globalRegistered) {
      return "global";
    }
    if (repoLocalRegistered) {
      return "repo-local";
    }
    return "none";
  }

  static scopesToEnsure(context: RegistrationContext): Scope[] {
    if (context === "both") {
      return ["global", "local"];
    }
    if (context === "global") {
      return ["global"];
    }
    if (context === "repo-local") {
      return ["local"];
    }
    return [];
  }

  static async hasAnyInstallation(directory: string): Promise<boolean> {
    const packageName = await getPackageName();
    const globalInstalled = await isScopeInstalled(getGlobalConfigPath(), packageName);
    if (globalInstalled) {
      return true;
    }
    return isScopeInstalled(getLocalConfigPath(directory), packageName);
  }

  private static async isRegisteredInGlobalBase(packageName: string): Promise<boolean> {
    const globalBase = getGlobalConfigPath();
    const jsonOutcome = await isPluginInConfig(join(globalBase, "opencode.json"), packageName);
    const jsoncOutcome = await isPluginInConfig(join(globalBase, "opencode.jsonc"), packageName);
    if (jsonOutcome || jsoncOutcome) {
      return true;
    }
    return isPluginInConfig(join(globalBase, "config.json"), packageName);
  }

  private static async isRegisteredInBase(base: string, packageName: string): Promise<boolean> {
    const jsonOutcome = await isPluginInConfig(join(base, "opencode.json"), packageName);
    const jsoncOutcome = await isPluginInConfig(join(base, "opencode.jsonc"), packageName);
    return jsonOutcome || jsoncOutcome;
  }

  private static async isRegisteredInRepo(directory: string, packageName: string): Promise<boolean> {
    const nestedRegistered = await RegistrationDetector.isRegisteredInBase(
      getLocalConfigPath(directory),
      packageName
    );
    if (nestedRegistered) {
      return true;
    }
    return RegistrationDetector.isRegisteredInBase(directory, packageName);
  }
}
