import { clearPackageCache } from "../installer.ts";

export async function clearCacheCommand(): Promise<void> {
  const outcome = await clearPackageCache();
  if (outcome.removed.length === 0) {
    console.log("No cached copies of this package found; nothing to remove.");
  } else {
    console.log("Removed cached copies of this package:");
    for (const target of outcome.removed) {
      console.log(`  Removed: ${target}`);
    }
  }
  for (const warning of outcome.warnings) {
    console.warn(`  Warning: ${warning}`);
  }
}
