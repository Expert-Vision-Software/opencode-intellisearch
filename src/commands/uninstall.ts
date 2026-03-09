import { select } from "@inquirer/prompts";
import { uninstall, type Scope } from "../installer.ts";
import { confirmOverwrite } from "../prompts.ts";

interface UninstallOptions {
  scope?: Scope;
  force?: boolean;
}

export async function uninstallCommand(options: UninstallOptions): Promise<void> {
  let scope: Scope;

  if (options.scope) {
    scope = options.scope;
  } else {
    const selected = await select({
      message: "Where do you want to uninstall intellisearch from?",
      choices: [
        { name: "Local (project only)", value: "local" as Scope },
        { name: "Global (all projects)", value: "global" as Scope },
      ],
    });
    scope = selected;
  }

  if (!options.force) {
    const shouldContinue = await confirmOverwrite(
      `Remove intellisearch from ${scope} installation?`
    );
    if (!shouldContinue) {
      console.log("Uninstall cancelled.");
      return;
    }
  }

  const result = await uninstall(scope, process.cwd());

  if (result.removed.length > 0) {
    console.log(`\nUninstalled intellisearch from ${scope} location:`);
    for (const path of result.removed) {
      console.log(`  Removed: ${path}`);
    }
    if (result.pluginRemoved) {
      console.log(`  Plugin: removed from config`);
    }
  } else {
    console.log(`\nIntellisearch was not installed in ${scope} location.`);
  }
}
