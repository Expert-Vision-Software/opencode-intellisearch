import { confirm } from "@inquirer/prompts";

export async function confirmOverwrite(message: string): Promise<boolean> {
  return confirm({
    message,
    default: false,
  });
}

export async function confirmPermissionConfig(): Promise<boolean> {
  return confirm({
    message: "Configure skill permission (allow intellisearch)?",
    default: true,
  });
}

export async function confirmMcpConfig(): Promise<boolean> {
  return confirm({
    message: "Configure DeepWiki MCP server?",
    default: true,
  });
}

export async function confirmPluginConfig(): Promise<boolean> {
  return confirm({
    message: "Add plugin to opencode.json config?",
    default: true,
  });
}
