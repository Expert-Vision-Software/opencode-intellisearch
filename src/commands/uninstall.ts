import { select } from "@inquirer/prompts";
import { uninstall, type Scope } from "../installer.ts";
import { confirmOverwrite } from "../prompts.ts";

interface UninstallOptions {
  scope: Scope | null;
  force: boolean;
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
  }

  const result = await uninstall(scope, process.cwd());

  if (result.removed.length > 0) {
    console.log(`\nUninstalled ${packageName} from ${scope} location:`);
    for (const path of result.removed) {
      console.log(`  Removed: ${path}`);
    }
    if (result.pluginRemoved) {
      console.log(`  Plugin: removed from config`);
    }
  } else {
    console.log(`\n${packageName} was not installed in ${scope} location.`);
  }
}
