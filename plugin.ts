import type { Plugin } from "@opencode-ai/plugin";
import { mkdir, readdir, copyFile, readFile } from "node:fs/promises";
import path from "node:path";

const VERSION: string = JSON.parse(
  await readFile(path.join(import.meta.dirname, "package.json"), "utf-8")
).version;

async function copyDir(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    entry.isDirectory() ? await copyDir(s, d) : await copyFile(s, d);
  }
}

const plugin: Plugin = async ({ directory }) => ({
  config: async (config) => {
    const targetDir = path.join(directory, ".opencode");
    const marker = path.join(targetDir, "skills", "intellisearch", ".version");

    try {
      if ((await Bun.file(marker).text()).trim() === VERSION) return;
    } catch {
      // not installed
    }

    const pkgDir = import.meta.dirname;
    await copyDir(
      path.join(pkgDir, "assets", "skills", "intellisearch"),
      path.join(targetDir, "skills", "intellisearch"),
    );
    await mkdir(path.join(targetDir, "commands"), { recursive: true });
    await copyFile(
      path.join(pkgDir, "assets", "commands", "search-intelligently.md"),
      path.join(targetDir, "commands", "search-intelligently.md"),
    );

    await Bun.write(marker, VERSION);
  },
});

export default plugin;
