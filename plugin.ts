import type { Plugin } from "@opencode-ai/plugin";
import { mkdir, readdir } from "node:fs/promises";

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

const plugin: Plugin = async ({ directory }) => ({
  config: async (config) => {
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
  },
});

export default plugin;
