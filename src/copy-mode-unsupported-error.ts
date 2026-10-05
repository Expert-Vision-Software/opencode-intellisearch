export class CopyModeUnsupportedError extends Error {
  constructor(packageName: string) {
    super(
      `${packageName} is a code-backed package ("content": "code" in package.json) and cannot be installed in copy mode. ` +
        `Code-backed packages always register as a plugin: run the install without --mode, or with --mode plugin.`
    );
  }
}
