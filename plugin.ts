import type { Plugin } from "@opencode-ai/plugin";
import { install, getGlobalConfigPath, getPackageVersion, type Scope } from "./src/installer.ts";
import { join } from "node:path";

const plugin: Plugin = async ({ directory }) => ({
  config: async () => {
    const version = await getPackageVersion();
    const globalConfigPath = getGlobalConfigPath();
    const globalVersionMarker = join(globalConfigPath, "skills", "intellisearch", ".version");

    const isGlobalInstall = directory === globalConfigPath || 
      directory.startsWith(globalConfigPath + "/") ||
      directory.startsWith(globalConfigPath + "\\");

    let scope: Scope;
    
    if (isGlobalInstall) {
      scope = "global";
    } else {
      try {
        const globalVersion = (await Bun.file(globalVersionMarker).text()).trim();
        if (globalVersion === version) {
          return;
        }
      } catch {
        // Global not installed, proceed with local
      }
      scope = "local";
    }

    const marker = scope === "global"
      ? globalVersionMarker
      : join(directory, ".opencode", "skills", "intellisearch", ".version");

    try {
      const installedVersion = (await Bun.file(marker).text()).trim();
      if (installedVersion === version) {
        return;
      }
    } catch {
      // Not installed, proceed
    }

    const result = await install(scope, directory);
    
    console.log(`\nOpenCode IntelliSearch installed ${scope === "global" ? "globally" : "locally"}:`);
    console.log(`  Skill: ${result.skillPath}`);
    console.log(`  Command: ${result.commandPath}`);
    if (result.migrated) {
      console.log(`  Migrated: opencode.json → .opencode/opencode.json`);
    }
  },
});

export default plugin;
