export class AssetSourceMissingError extends Error {
  constructor(missingPath: string, packageName: string, packageVersion: string, cacheDir: string) {
    super(
      `Bundled asset directory missing or empty: ${missingPath}. ` +
        `The ${packageName} v${packageVersion} package cache is partial. ` +
        `Clear this package's cached copies from ${cacheDir} with: bunx ${packageName} clear-cache, ` +
        `then reinstall with: bunx ${packageName} install --scope global`
    );
  }
}
