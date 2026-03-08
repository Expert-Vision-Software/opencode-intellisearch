import { select } from "@inquirer/prompts";
import {
  install,
  checkMigrationNeeded,
  type Scope,
} from "../installer.ts";
import { confirmOverwrite } from "../prompts.ts";

interface InstallOptions {
  scope?: Scope;
  force?: boolean;
}

export async function installCommand(options: InstallOptions): Promise<void> {
  let scope: Scope;

  if (options.scope) {
    scope = options.scope;
  } else {
    const selected = await select({
      message: "Where do you want to install intellisearch?",
      choices: [
        { name: "Local (project only)", value: "local" as Scope },
        { name: "Global (all projects)", value: "global" as Scope },
      ],
    });
    scope = selected;
  }

  const projectDir = process.cwd();

  if (scope === "local") {
    const migration = await checkMigrationNeeded(projectDir);
    
    if (migration.needed && migration.rootConfig && migration.dotOpenencodeConfig) {
      const dotConfig = migration.dotOpenencodeConfig as Record<string, unknown>;
      const hasConflict = Object.keys(migration.rootConfig).some(
        key => key in dotConfig
      );
      
      if (hasConflict) {
        const shouldContinue = await confirmOverwrite(
          "Both opencode.json and .opencode/opencode.json exist with conflicting keys. Continue with migration (.opencode takes precedence)?"
        );
        if (!shouldContinue) {
          console.log("Installation cancelled.");
          return;
        }
      }
    }
  }

  const result = await install(scope, projectDir);

  console.log(`\nInstalled intellisearch ${scope === "global" ? "globally" : "locally"}:`);
  console.log(`  Skill: ${result.skillPath}`);
  console.log(`  Command: ${result.commandPath}`);
  console.log(`  Config: ${result.configPath}`);
  
  if (result.migrated) {
    console.log(`  Migrated: opencode.json → .opencode/opencode.json`);
  }
}
