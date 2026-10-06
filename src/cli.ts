#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { installCommand } from "./commands/install.ts";
import { uninstallCommand } from "./commands/uninstall.ts";
import { statusCommand } from "./commands/status.ts";
import { clearCacheCommand } from "./commands/clear-cache.ts";
import type { InstallMode, Scope } from "./installer.ts";

const VERSION = JSON.parse(
  await Bun.file(`${import.meta.dirname}/../package.json`).text()
).version;

function printHelp(): void {
  console.log(`
opencode-intellisearch v${VERSION}

Commands:
  install      Install the intellisearch skill and command and register the plugin
  uninstall    Remove the intellisearch skill and command (manifest-recorded files only)
  status       Check installation status
  clear-cache  Remove cached copies of this package from OpenCode's package cache

Options:
  -s, --scope <scope>    Installation scope: "local" or "global"
  -m, --mode <mode>      Install mode: "plugin" (default) or "copy" (unsupported: this package is code-backed)
      --migrate          Consent to migrating a root opencode.json into .opencode/ (local installs only, default: false)
      --purge-config     With uninstall, also remove the package-managed config entries
                         (plugin entry, skill.intellisearch permission, deepwiki MCP server)
  -f, --force            Skip confirmation prompts / overwrite consumer-modified files
  -h, --help             Show this help message
  -v, --version          Show version

Examples:
  opencode-intellisearch install
  opencode-intellisearch install --scope global
  opencode-intellisearch install --scope local --migrate
  opencode-intellisearch uninstall --scope local
  opencode-intellisearch uninstall --scope local --purge-config
  opencode-intellisearch status
  opencode-intellisearch clear-cache
`);
}

function isInstallMode(value: string): value is InstallMode {
  return value === "copy" || value === "plugin";
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    options: {
      scope: {
        type: "string",
        short: "s",
      },
      mode: {
        type: "string",
        short: "m",
      },
      migrate: {
        type: "boolean",
        default: false,
      },
      "purge-config": {
        type: "boolean",
        default: false,
      },
      force: {
        type: "boolean",
        short: "f",
        default: false,
      },
      help: {
        type: "boolean",
        short: "h",
        default: false,
      },
      version: {
        type: "boolean",
        short: "v",
        default: false,
      },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.version) {
    console.log(`opencode-intellisearch v${VERSION}`);
    process.exit(0);
  }

  if (values.help || positionals.length === 0) {
    printHelp();
    process.exit(0);
  }

  const command = positionals[0];
  const scope: Scope | undefined = values.scope as Scope | undefined;
  const force: boolean = values.force === true;
  const migrate: boolean = values.migrate === true;
  const mode: InstallMode | null = values.mode === undefined ? null : isInstallMode(values.mode) ? values.mode : null;

  if (scope && scope !== "local" && scope !== "global") {
    console.error(`Invalid scope: ${scope}. Must be "local" or "global".`);
    process.exit(1);
  }

  if (values.mode !== undefined && mode === null) {
    console.error(`Invalid mode: ${values.mode}. Must be "copy" or "plugin".`);
    process.exit(1);
  }

  try {
    switch (command) {
      case "install":
        await installCommand({ scope: scope ?? null, force, migrate, mode });
        break;
      case "uninstall":
        await uninstallCommand({ scope: scope ?? null, force, purgeConfig: values["purge-config"] === true });
        break;
      case "status":
        await statusCommand();
        break;
      case "clear-cache":
        if (positionals.length > 1) {
          console.error(`Unexpected arguments for clear-cache: ${positionals.slice(1).join(" ")}`);
          process.exit(1);
        }
        await clearCacheCommand();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
