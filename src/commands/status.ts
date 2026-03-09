import { status } from "../installer.ts";

export async function statusCommand(): Promise<void> {
  const result = await status(process.cwd());

  const lines: string[] = [];

  if (result.local?.installed) {
    const versionInfo = result.local.version 
      ? ` (v${result.local.version})` 
      : " (version unknown)";
    const pluginInfo = result.local.pluginInConfig 
      ? " [plugin in config]" 
      : "";
    lines.push(`Local: installed${versionInfo}${pluginInfo}`);
  } else {
    lines.push("Local: not installed");
  }

  if (result.global?.installed) {
    const versionInfo = result.global.version 
      ? ` (v${result.global.version})` 
      : " (version unknown)";
    const pluginInfo = result.global.pluginInConfig 
      ? " [plugin in config]" 
      : "";
    lines.push(`Global: installed${versionInfo}${pluginInfo}`);
  } else {
    lines.push("Global: not installed");
  }

  console.log(lines.join("\n"));
}
