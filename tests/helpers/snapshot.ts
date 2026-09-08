import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface DirectorySnapshot {
  [relativePath: string]: string;
}

export async function snapshotDirectory(root: string): Promise<DirectorySnapshot> {
  const snapshot: DirectorySnapshot = {};
  await walkDirectory(root, root, snapshot);
  return snapshot;
}

async function walkDirectory(root: string, current: string, snapshot: DirectorySnapshot): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const fullPath = join(current, entry.name);
    const relativePath = fullPath.slice(root.length + 1).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      await walkDirectory(root, fullPath, snapshot);
    } else {
      snapshot[relativePath] = await readFile(fullPath, "utf-8");
    }
  }
}
