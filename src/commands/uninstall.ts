import { select } from "@inquirer/prompts";
import { uninstall, type Scope } from "../installer.ts";
import { confirmOverwrite } from "../prompts.ts";

interface UninstallOptions {
  scope: Scope | null;
  force: boolean;
  purgeConfig: boolean;
}

export async function uninstallCommand(options: UninstallOptions): Promise<void> {
  const packageName = JSON.parse(
    await Bun.file(`${import.meta.dirname}/../../package.json`).text()
  ).name;

  let scope: Scope;

  if (options.scope) {
    scope = options.scope;
  } else {
    const selected = await select({
      message: `Where do you want to uninstall ${packageName} from?`,
      choices: [
        { name: "Local (project only)", value: "local" as Scope },
        { name: "Global (all projects)", value: "global" as Scope },
      ],
    });
    scope = selected;
  }

  if (!options.force) {
    const shouldContinue = await confirmOverwrite(
      `Remove ${packageName} from ${scope} installation?`
    );
    if (!shouldContinue) {
      console.log("Uninstall cancelled.");
      return;
    }
    if (options.purgeConfig) {
      const shouldPurge = await confirmOverwrite(
        `Also remove the ${packageName} plugin entry, skill.intellisearch permission, and deepwiki MCP server from the config?`
      );
      if (!shouldPurge) {
        options.purgeConfig = false;
      }
    }
  }

  const result = await uninstall(scope, process.cwd(), { purgeConfig: options.purgeConfig });

  if (result.removed.length > 0) {
    console.log(`\nUninstalled ${packageName} from ${scope} location:`);
    for (const path of result.removed) {
      console.log(`  Removed: ${path}`);
    }
  } else {
    console.log(`\n${packageName} was not installed in ${scope} location.`);
  }
  if (result.pluginRemoved) {
    console.log(`  Plugin: removed from config`);
  }
  if (result.permissionRemoved) {
    console.log(`  Permission: skill.intellisearch removed from config`);
  }
  if (result.mcpRemoved) {
    console.log(`  MCP: deepwiki server removed from config`);
  }
}
