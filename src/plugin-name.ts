export class PluginNameNormalizer {
  private static readonly AT_INDEX_NONE: number = -1;
  private static readonly LATEST_TAG: string = "latest";

  static normalize(entry: string): string {
    const trimmed: string = entry.trim().toLowerCase();
    const firstAt: number = trimmed.indexOf("@");
    if (firstAt === 0) {
      const secondAt: number = trimmed.indexOf("@", 1);
      if (secondAt !== PluginNameNormalizer.AT_INDEX_NONE) {
        return trimmed.slice(0, secondAt);
      }
      return trimmed;
    }
    if (firstAt !== PluginNameNormalizer.AT_INDEX_NONE) {
      return trimmed.slice(0, firstAt);
    }
    return trimmed;
  }

  static canonicalize(entry: string): string {
    return `${PluginNameNormalizer.normalize(entry)}@${PluginNameNormalizer.LATEST_TAG}`;
  }

  static matches(entry: string, packageName: string): boolean {
    return PluginNameNormalizer.normalize(entry) === packageName.trim().toLowerCase();
  }
}
