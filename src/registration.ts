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

const GLOBAL_BASE_FILES = ["opencode.json", "opencode.jsonc", "config.json"];
const BASE_FILES = ["opencode.json", "opencode.jsonc"];

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

  private static candidatePaths(base: string, fileNames: string[]): string[] {
    return fileNames.map(fileName => join(base, fileName));
  }

  private static async anyCandidateRegisters(
    candidatePaths: string[],
    packageName: string
  ): Promise<boolean> {
    const outcomes: boolean[] = [];
    for (const candidatePath of candidatePaths) {
      outcomes.push(await isPluginInConfig(candidatePath, packageName));
    }
    return outcomes.some(registered => registered);
  }

  private static async isRegisteredInGlobalBase(packageName: string): Promise<boolean> {
    const globalCandidates = RegistrationDetector.candidatePaths(getGlobalConfigPath(), GLOBAL_BASE_FILES);
    return RegistrationDetector.anyCandidateRegisters(globalCandidates, packageName);
  }

  private static async isRegisteredInBase(base: string, packageName: string): Promise<boolean> {
    const baseCandidates = RegistrationDetector.candidatePaths(base, BASE_FILES);
    return RegistrationDetector.anyCandidateRegisters(baseCandidates, packageName);
  }

  private static async isRegisteredInRepo(directory: string, packageName: string): Promise<boolean> {
    const nestedRegistered = await RegistrationDetector.isRegisteredInBase(
      getLocalConfigPath(directory),
      packageName
    );
    const rootRegistered = await RegistrationDetector.isRegisteredInBase(directory, packageName);
    return nestedRegistered || rootRegistered;
  }
}
