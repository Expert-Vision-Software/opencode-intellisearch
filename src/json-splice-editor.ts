import { JsoncReader } from "./jsonc.ts";

interface ObjectBounds {
  start: number;
  end: number;
}

interface ObjectEntryLocation {
  key: string;
  entryStart: number;
  valueStart: number;
  valueEnd: number;
}

interface ElementLocation {
  start: number;
  end: number;
}

export class JsonSpliceEditor {
  topLevelValueRange(text: string, key: string): { start: number; end: number } | null {
    const navigable = JsoncReader.toStrictText(text);
    const root = this.rootObjectBounds(navigable);
    if (root === null) return null;
    const entries = this.objectEntries(navigable, root);
    if (entries === null) return null;
    const entry = entries.find(candidate => candidate.key === key);
    if (!entry) return null;
    return { start: entry.valueStart, end: entry.valueEnd };
  }

  setObjectEntry(text: string, path: string[], rawValue: string, lenient: boolean): string | null {
    const navigable = JsoncReader.toStrictText(text);
    const root = this.rootObjectBounds(navigable);
    if (root === null) return null;
    const spliced = this.buildEntryChain(text, navigable, root, path, rawValue, 1);
    if (spliced === null) return null;
    return this.validated(spliced, lenient);
  }

  addArrayElement(text: string, key: string, rawElement: string, lenient: boolean): string | null {
    const navigable = JsoncReader.toStrictText(text);
    const entry = this.topLevelEntry(navigable, key);
    if (!entry) return null;
    const arrayBounds = this.arrayValueBounds(navigable, entry);
    if (arrayBounds === null) return null;
    const spliced = this.insertArrayElement(text, arrayBounds, rawElement);
    if (spliced === null) return null;
    return this.validated(spliced, lenient);
  }

  removeArrayElements(
    text: string,
    key: string,
    matches: (element: string) => boolean,
    lenient: boolean
  ): string | null {
    let current = text;
    let removedAny = false;
    for (;;) {
      const navigable = JsoncReader.toStrictText(current);
      const entry = this.topLevelEntry(navigable, key);
      if (!entry) break;
      const arrayBounds = this.arrayValueBounds(navigable, entry);
      if (arrayBounds === null) return null;
      const elements = this.arrayElements(navigable, arrayBounds);
      if (elements === null) return null;
      const target = elements.find(element =>
        matches(this.unquote(current.slice(element.start, element.end)))
      );
      if (!target) break;
      const next = this.removeSingleElement(current, elements, target);
      if (next === null) return null;
      current = next;
      removedAny = true;
    }
    if (!removedAny) return null;
    return this.validated(current, lenient);
  }

  private buildEntryChain(
    text: string,
    navigable: string,
    bounds: ObjectBounds,
    path: string[],
    rawValue: string,
    depth: number
  ): string | null {
    const head = path[0];
    if (head === undefined) return null;
    const rest = path.slice(1);
    const entries = this.objectEntries(navigable, bounds);
    if (entries === null) return null;
    const existing = entries.find(candidate => candidate.key === head);
    if (rest.length === 0) {
      if (existing) return this.replaceEntryValue(text, existing, rawValue);
      return this.insertObjectEntry(text, bounds, `${JSON.stringify(head)}: ${rawValue}`);
    }
    if (!existing) {
      const nested = this.buildNestedRawValue(text, rest, rawValue, depth);
      return this.insertObjectEntry(text, bounds, `${JSON.stringify(head)}: ${nested}`);
    }
    const nestedBounds = this.objectValueBounds(navigable, existing);
    if (nestedBounds === null) return null;
    return this.buildEntryChain(text, navigable, nestedBounds, rest, rawValue, depth + 1);
  }

  private buildNestedRawValue(text: string, path: string[], rawValue: string, baseDepth: number): string {
    const unit = this.indentUnit(text);
    const lastIndex = path.length - 1;
    let result = rawValue;
    for (let i = lastIndex; i >= 0; i--) {
      const key = path[i] ?? "";
      const keyIndent = unit.repeat(baseDepth + i + 1);
      const closeIndent = unit.repeat(baseDepth + i);
      result = `{\n${keyIndent}${JSON.stringify(key)}: ${result}\n${closeIndent}}`;
    }
    return result;
  }

  private replaceEntryValue(text: string, entry: ObjectEntryLocation, rawValue: string): string | null {
    const navigable = JsoncReader.toStrictText(text);
    const valueSlice = navigable.slice(entry.valueStart, entry.valueEnd).trim();
    if (valueSlice.startsWith("{") || valueSlice.startsWith("[")) return null;
    return text.slice(0, entry.valueStart) + rawValue + text.slice(entry.valueEnd);
  }

  private insertObjectEntry(text: string, bounds: ObjectBounds, entryRaw: string): string | null {
    const navigable = JsoncReader.toStrictText(text);
    const innerStart = bounds.start + 1;
    const innerEnd = bounds.end - 1;
    let firstContent = innerStart;
    while (firstContent < innerEnd && /\s/.test(navigable[firstContent] ?? "")) firstContent++;
    const objectIndent = this.lineIndent(text, bounds.start);
    const childIndent = objectIndent + this.indentUnit(text);
    if (firstContent >= innerEnd) {
      if (!text.slice(innerStart, innerEnd).includes("\n")) {
        return text.slice(0, bounds.start) + "{ " + entryRaw + " }" + text.slice(bounds.end);
      }
      return (
        text.slice(0, innerStart) +
        "\n" +
        childIndent +
        entryRaw +
        ",\n" +
        objectIndent +
        text.slice(innerEnd)
      );
    }
    if (!text.slice(bounds.start, firstContent).includes("\n")) {
      return text.slice(0, firstContent) + entryRaw + ", " + text.slice(firstContent);
    }
    const insertAt = this.lineStartIndex(text, firstContent);
    return text.slice(0, insertAt) + childIndent + entryRaw + ",\n" + text.slice(insertAt);
  }

  private insertArrayElement(text: string, bounds: ObjectBounds, rawElement: string): string | null {
    const navigable = JsoncReader.toStrictText(text);
    const innerStart = bounds.start + 1;
    const innerEnd = bounds.end - 1;
    let firstContent = innerStart;
    while (firstContent < innerEnd && /\s/.test(navigable[firstContent] ?? "")) firstContent++;
    const arrayIndent = this.lineIndent(text, bounds.start);
    const childIndent = arrayIndent + this.indentUnit(text);
    if (firstContent >= innerEnd) {
      if (!text.slice(innerStart, innerEnd).includes("\n")) {
        return text.slice(0, bounds.start) + "[" + rawElement + "]" + text.slice(bounds.end);
      }
      return (
        text.slice(0, innerStart) +
        "\n" +
        childIndent +
        rawElement +
        ",\n" +
        arrayIndent +
        text.slice(innerEnd)
      );
    }
    if (!text.slice(bounds.start, firstContent).includes("\n")) {
      return text.slice(0, firstContent) + rawElement + ", " + text.slice(firstContent);
    }
    const insertAt = this.lineStartIndex(text, firstContent);
    return text.slice(0, insertAt) + childIndent + rawElement + ",\n" + text.slice(insertAt);
  }

  private removeSingleElement(
    text: string,
    elements: ElementLocation[],
    target: ElementLocation
  ): string | null {
    const index = elements.indexOf(target);
    const next = elements[index + 1];
    if (next) return text.slice(0, target.start) + text.slice(next.start);
    const previous = index > 0 ? elements[index - 1] : undefined;
    if (previous) return text.slice(0, previous.end) + text.slice(target.end);
    return text.slice(0, target.start) + text.slice(target.end);
  }

  private topLevelEntry(navigable: string, key: string): ObjectEntryLocation | null {
    const root = this.rootObjectBounds(navigable);
    if (root === null) return null;
    const entries = this.objectEntries(navigable, root);
    if (entries === null) return null;
    return entries.find(candidate => candidate.key === key) ?? null;
  }

  private rootObjectBounds(navigable: string): ObjectBounds | null {
    const objectStart = this.firstStructuralChar(navigable, "{");
    if (objectStart === -1) return null;
    const objectEnd = this.matchingBracket(navigable, objectStart);
    if (objectEnd === null) return null;
    return { start: objectStart, end: objectEnd + 1 };
  }

  private objectValueBounds(navigable: string, entry: ObjectEntryLocation): ObjectBounds | null {
    return this.containerValueBounds(navigable, entry.valueStart, entry.valueEnd, "{");
  }

  private arrayValueBounds(navigable: string, entry: ObjectEntryLocation): ObjectBounds | null {
    return this.containerValueBounds(navigable, entry.valueStart, entry.valueEnd, "[");
  }

  private containerValueBounds(
    navigable: string,
    valueStart: number,
    valueEnd: number,
    openChar: string
  ): ObjectBounds | null {
    let cursor = valueStart;
    while (cursor < valueEnd && /\s/.test(navigable[cursor] ?? "")) cursor++;
    if (navigable[cursor] !== openChar) return null;
    const closeIndex = this.matchingBracket(navigable, cursor);
    if (closeIndex === null || closeIndex >= valueEnd) return null;
    return { start: cursor, end: closeIndex + 1 };
  }

  private objectEntries(navigable: string, bounds: ObjectBounds): ObjectEntryLocation[] | null {
    const entries: ObjectEntryLocation[] = [];
    const innerEnd = bounds.end - 1;
    let i = bounds.start + 1;
    while (i < innerEnd) {
      while (i < innerEnd && /\s/.test(navigable[i] ?? "")) i++;
      if (i >= innerEnd) break;
      if (navigable[i] !== '"') return null;
      const keyStart = i;
      const keyEnd = this.stringEnd(navigable, i);
      if (keyEnd === null) return null;
      const key = this.unquote(navigable.slice(keyStart, keyEnd));
      i = keyEnd;
      while (i < innerEnd && /\s/.test(navigable[i] ?? "")) i++;
      if (navigable[i] !== ":") return null;
      i++;
      while (i < innerEnd && /\s/.test(navigable[i] ?? "")) i++;
      const valueStart = i;
      const valueEnd = this.valueEnd(navigable, i, innerEnd);
      if (valueEnd === null) return null;
      entries.push({ key, entryStart: keyStart, valueStart, valueEnd });
      i = valueEnd;
      while (i < innerEnd && /\s/.test(navigable[i] ?? "")) i++;
      if (navigable[i] === ",") {
        i++;
        continue;
      }
      if (i >= innerEnd) break;
      return null;
    }
    return entries;
  }

  private arrayElements(navigable: string, bounds: ObjectBounds): ElementLocation[] | null {
    const elements: ElementLocation[] = [];
    const innerEnd = bounds.end - 1;
    let i = bounds.start + 1;
    while (i < innerEnd) {
      while (i < innerEnd && /\s/.test(navigable[i] ?? "")) i++;
      if (i >= innerEnd) break;
      const start = i;
      const end = this.valueEnd(navigable, i, innerEnd);
      if (end === null) return null;
      elements.push({ start, end });
      i = end;
      while (i < innerEnd && /\s/.test(navigable[i] ?? "")) i++;
      if (navigable[i] === ",") {
        i++;
        continue;
      }
      if (i >= innerEnd) break;
      return null;
    }
    return elements;
  }

  private valueEnd(text: string, from: number, closingIndex: number): number | null {
    let depth = 0;
    let inString = false;
    for (let i = from; i <= closingIndex; i++) {
      const current = text[i] ?? "";
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
      if (current === "{" || current === "[") {
        depth++;
        continue;
      }
      if (current === "}" || current === "]") {
        if (depth === 0) return i;
        depth--;
        continue;
      }
      if (current === "," && depth === 0) return i;
    }
    return null;
  }

  private stringEnd(text: string, start: number): number | null {
    for (let i = start + 1; i < text.length; i++) {
      const current = text[i] ?? "";
      if (current === "\\") {
        i++;
        continue;
      }
      if (current === '"') return i + 1;
    }
    return null;
  }

  private firstStructuralChar(text: string, target: string): number {
    let inString = false;
    for (let i = 0; i < text.length; i++) {
      const current = text[i] ?? "";
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
      if (current === target) return i;
    }
    return -1;
  }

  private matchingBracket(text: string, openIndex: number): number | null {
    const open = text[openIndex] ?? "";
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    for (let i = openIndex; i < text.length; i++) {
      const current = text[i] ?? "";
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
      if (current === open) depth++;
      else if (current === close) {
        depth--;
        if (depth === 0) return i;
      }
    }
    return null;
  }

  private lineStartIndex(text: string, index: number): number {
    let lineStart = index;
    while (lineStart > 0 && text[lineStart - 1] !== "\n") lineStart--;
    return lineStart;
  }

  private lineIndent(text: string, index: number): string {
    let lineStart = index;
    while (lineStart > 0 && text[lineStart - 1] !== "\n") lineStart--;
    let indent = "";
    for (let i = lineStart; i < index; i++) {
      const current = text[i] ?? "";
      if (current === " " || current === "\t") indent += current;
      else break;
    }
    return indent;
  }

  private indentUnit(text: string): string {
    let atLineStart = true;
    let run = "";
    for (let i = 0; i < text.length; i++) {
      const current = text[i] ?? "";
      if (current === "\n") {
        atLineStart = true;
        run = "";
        continue;
      }
      if (atLineStart && (current === " " || current === "\t")) {
        run += current;
        continue;
      }
      if (atLineStart && run.length > 0) return run;
      atLineStart = false;
    }
    return "  ";
  }

  private unquote(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  private validated(text: string, lenient: boolean): string | null {
    try {
      if (lenient) {
        JsoncReader.parse(text);
      } else {
        JSON.parse(text);
      }
    } catch {
      return null;
    }
    return text;
  }
}
