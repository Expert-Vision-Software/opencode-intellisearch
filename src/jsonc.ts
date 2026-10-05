export class JsoncReader {
  static parse(text: string): unknown {
    return JSON.parse(JsoncReader.toStrictText(text));
  }

  static parseConfigFile(text: string, configPath: string): unknown {
    if (JsoncReader.isLenientPath(configPath)) {
      return JsoncReader.parse(text);
    }
    return JSON.parse(text);
  }

  static isLenientPath(configPath: string): boolean {
    return configPath.endsWith(".jsonc");
  }

  static toStrictText(text: string): string {
    return JsoncReader.blankTrailingCommas(JsoncReader.blankComments(text));
  }

  private static blankComments(text: string): string {
    const chars = text.split("");
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;
    for (let i = 0; i < chars.length; i++) {
      const current = chars[i] ?? "";
      const next = i + 1 < chars.length ? (chars[i + 1] ?? "") : "";
      if (inLineComment) {
        if (current === "\n") {
          inLineComment = false;
          continue;
        }
        chars[i] = " ";
        continue;
      }
      if (inBlockComment) {
        if (current === "*" && next === "/") {
          chars[i] = " ";
          chars[i + 1] = " ";
          i++;
          inBlockComment = false;
          continue;
        }
        if (current !== "\n") {
          chars[i] = " ";
        }
        continue;
      }
      if (inString) {
        if (current === "\\") {
          i++;
          continue;
        }
        if (current === '"') inString = false;
        continue;
      }
      if (current === '"') {
        inString = true;
        continue;
      }
      if (current === "/" && next === "/") {
        chars[i] = " ";
        chars[i + 1] = " ";
        inLineComment = true;
        continue;
      }
      if (current === "/" && next === "*") {
        chars[i] = " ";
        chars[i + 1] = " ";
        inBlockComment = true;
        continue;
      }
    }
    return chars.join("");
  }

  private static blankTrailingCommas(text: string): string {
    const chars = text.split("");
    let inString = false;
    for (let i = 0; i < chars.length; i++) {
      const current = chars[i] ?? "";
      if (inString) {
        if (current === "\\") {
          i++;
          continue;
        }
        if (current === '"') inString = false;
        continue;
      }
      if (current === '"') {
        inString = true;
        continue;
      }
      if (current !== ",") continue;
      let lookahead = i + 1;
      while (lookahead < chars.length && /\s/.test(chars[lookahead] ?? "")) lookahead++;
      const nextSignificant = chars[lookahead] ?? "";
      if (nextSignificant === "]" || nextSignificant === "}") {
        chars[i] = " ";
      }
    }
    return chars.join("");
  }
}
