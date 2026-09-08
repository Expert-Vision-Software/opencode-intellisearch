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
    const globalRegistered = await isPluginInConfig(join(getGlobalConfigPath(), "opencode.json"), packageName);
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

  private static async isRegisteredInRepo(directory: string, packageName: string): Promise<boolean> {
    const nestedConfigPath = join(getLocalConfigPath(directory), "opencode.json");
    if (await isPluginInConfig(nestedConfigPath, packageName)) {
      return true;
    }
    const rootConfigPath = join(directory, "opencode.json");
    return isPluginInConfig(rootConfigPath, packageName);
  }
}
