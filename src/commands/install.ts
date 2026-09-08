import { select } from "@inquirer/prompts";
import {
  install,
  checkMigrationNeeded,
  type Scope,
  type InstallOptions,
} from "../installer.ts";
import {
  confirmOverwrite,
  confirmPermissionConfig,
  confirmMcpConfig,
  confirmPluginConfig,
} from "../prompts.ts";

interface InstallCommandOptions {
  scope?: Scope;
  force?: boolean;
}

export async function installCommand(options: InstallCommandOptions): Promise<void> {
  const packageName = JSON.parse(
    await Bun.file(`${import.meta.dirname}/../../package.json`).text()
  ).name;

  let scope: Scope;
  const interactive = !options.scope;

  if (options.scope) {
    scope = options.scope;
  } else {
    const selected = await select({
      message: `Where do you want to install ${packageName}?`,
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

  const installOptions: InstallOptions = {
    addPluginConfig: true,
    configurePermission: true,
    configureMcp: true,
    migrateRootConfig: true,
    force: options.force === true,
  };

  if (interactive) {
    installOptions.addPluginConfig = await confirmPluginConfig();
    installOptions.configurePermission = await confirmPermissionConfig();
    installOptions.configureMcp = await confirmMcpConfig();
  }

  const result = await install(scope, projectDir, installOptions);

  if (result.action === "noop") {
    console.log(`\n${packageName} is already up to date in the ${scope} location:`);
  } else {
    console.log(`\nInstalled ${packageName} ${scope === "global" ? "globally" : "locally"}:`);
  }

  if (result.skillPaths.length > 0) {
    console.log(`  Skills: ${result.skillPaths.join(", ")}`);
  }
  if (result.commandPaths.length > 0) {
    console.log(`  Commands: ${result.commandPaths.join(", ")}`);
  }
  console.log(`  Config: ${result.configPath}`);
  console.log(`  Manifest: ${result.manifestPath}`);

  for (const skippedPath of result.skipped) {
    console.log(`  Skipped (changed locally; re-run with --force to overwrite): ${skippedPath}`);
  }

  if (result.migrated) {
    console.log(`  Migrated: opencode.json → .opencode/opencode.json`);
  }

  if (result.pluginAdded) {
    console.log(`  Plugin: added to config`);
  }

  if (result.permissionConfigured) {
    console.log(`  Permission: skill.intellisearch = "allow"`);
  }

  if (result.mcpConfigured) {
    console.log(`  MCP: deepwiki server configured`);
  }
}
