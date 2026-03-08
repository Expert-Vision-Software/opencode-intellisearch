import { status } from "../installer.ts";

export async function statusCommand(): Promise<void> {
  const result = await status(process.cwd());

  const lines: string[] = [];

  if (result.local?.installed) {
    const versionInfo = result.local.version 
      ? ` (v${result.local.version})` 
      : " (version unknown)";
    lines.push(`Local: installed${versionInfo}`);
  } else {
    lines.push("Local: not installed");
  }

  if (result.global?.installed) {
    const versionInfo = result.global.version 
      ? ` (v${result.global.version})` 
      : " (version unknown)";
    lines.push(`Global: installed${versionInfo}`);
  } else {
    lines.push("Global: not installed");
  }

  console.log(lines.join("\n"));
}
