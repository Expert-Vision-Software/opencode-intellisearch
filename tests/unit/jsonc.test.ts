import { describe, test, expect } from "bun:test";
import { JsoncReader } from "../../src/jsonc.ts";

describe("JsoncReader fixture matrix", () => {
  test("parses line comments", () => {
    expect(JsoncReader.parse('{\n  // a comment\n  "model": "x"\n}')).toEqual({ model: "x" });
  });

  test("parses block comments", () => {
    expect(JsoncReader.parse('{\n  /* block\n   comment */\n  "model": "x"\n}')).toEqual({ model: "x" });
  });

  test("parses a trailing comma at array end", () => {
    expect(JsoncReader.parse('{ "plugin": ["a", "b",], }')).toEqual({ plugin: ["a", "b"] });
  });

  test("parses a trailing comma at object end", () => {
    expect(JsoncReader.parse('{ "a": 1, }')).toEqual({ a: 1 });
  });

  test("parses a comment between a trailing comma and its closing bracket", () => {
    const text = '{\n  "plugin": [\n    "opencode-intellisearch",\n    // trailing comment\n  ],\n}';
    expect(JsoncReader.parse(text)).toEqual({ plugin: ["opencode-intellisearch"] });
  });

  test("preserves a $schema URL containing //", () => {
    expect(JsoncReader.parse('{ "$schema": "https://opencode.ai/config.json" }')).toEqual({
      "$schema": "https://opencode.ai/config.json",
    });
  });

  test("preserves a string containing /*", () => {
    expect(JsoncReader.parse('{ "note": "a /* not a comment */" }')).toEqual({
      note: "a /* not a comment */",
    });
  });

  test("preserves a string containing //", () => {
    expect(JsoncReader.parse('{ "url": "https://example.com/path" }')).toEqual({
      url: "https://example.com/path",
    });
  });

  test("preserves escaped quotes inside strings", () => {
    expect(JsoncReader.parse('{ "quote": "say \\"hi\\"" }')).toEqual({ quote: 'say "hi"' });
  });

  test("preserves an escaped backslash before a quote", () => {
    expect(JsoncReader.parse('{ "path": "a\\\\" }')).toEqual({ path: "a\\" });
  });

  test("leaves a genuinely malformed file unparseable", () => {
    expect(() => JsoncReader.parse('{ "model": , }')).toThrow();
  });

  test("leaves truncated input unparseable", () => {
    expect(() => JsoncReader.parse('{ "plugin": [ "a" ')).toThrow();
  });

  test("strict mode rejects comments in .json files", () => {
    expect(() => JsoncReader.parseConfigFile('{ // c\n "a": 1 }', "/x/opencode.json")).toThrow();
  });

  test("lenient mode accepts comments in .jsonc files", () => {
    expect(JsoncReader.parseConfigFile('{ // c\n "a": 1 }', "/x/opencode.jsonc")).toEqual({ a: 1 });
  });

  test("strict text keeps the same length as the source", () => {
    const text = '{\n  // comment\n  "a": [1, 2,],\n}';
    expect(JsoncReader.toStrictText(text).length).toBe(text.length);
  });
});
