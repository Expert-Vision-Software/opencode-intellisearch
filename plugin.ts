import type { Plugin } from "@opencode-ai/plugin";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const VERSION: string = JSON.parse(
  await Bun.file(`${import.meta.dirname}/package.json`).text()
).version;

async function copyDir(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const s = `${src}/${entry.name}`;
    const d = `${dest}/${entry.name}`;
    entry.isDirectory() ? await copyDir(s, d) : await Bun.write(d, Bun.file(s));
  }
}

async function ensureSkillPermission(directory: string): Promise<void> {
  const configPath = join(directory, ".opencode", "opencode.json");
  let config: Record<string, unknown>;
  
  try {
    const content = await readFile(configPath, "utf-8");
    config = JSON.parse(content);
  } catch {
    config = {};
  }
  
  if (!config.permission) {
    config.permission = {};
  }
  if (!(config.permission as Record<string, unknown>).skill) {
    (config.permission as Record<string, unknown>).skill = {};
  }
  
  const skillPerms = (config.permission as Record<string, unknown>).skill as Record<string, unknown>;
  if (skillPerms.intellisearch !== "allow") {
    skillPerms.intellisearch = "allow";
    await mkdir(join(directory, ".opencode"), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2));
  }
}

const plugin: Plugin = async ({ directory }) => ({
  config: async () => {
    const targetDir = `${directory}/.opencode`;
    const marker = `${targetDir}/skills/intellisearch/.version`;

    try {
      if ((await Bun.file(marker).text()).trim() === VERSION) return;
    } catch {
      // not installed
    }

    const pkgDir = import.meta.dirname;
    await copyDir(
      `${pkgDir}/assets/skills/intellisearch`,
      `${targetDir}/skills/intellisearch`,
    );
    await mkdir(`${targetDir}/commands`, { recursive: true });
    await Bun.write(
      `${targetDir}/commands/search-intelligently.md`,
      Bun.file(`${pkgDir}/assets/commands/search-intelligently.md`),
    );

    await Bun.write(marker, VERSION);
    await ensureSkillPermission(directory);
  },
});

export default plugin;
