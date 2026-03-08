import { confirm } from "@inquirer/prompts";

export async function confirmOverwrite(message: string): Promise<boolean> {
  return confirm({
    message,
    default: false,
  });
}
