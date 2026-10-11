import { confirm } from "@inquirer/prompts";

export async function confirmOverwrite(message: string): Promise<boolean> {
  return confirm({
    message,
    default: false,
  });
}

export async function confirmMcpConfig(): Promise<boolean> {
  return confirm({
    message: "Configure DeepWiki MCP server?",
    default: true,
  });
}
