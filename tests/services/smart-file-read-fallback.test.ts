/**
 * Tests for plain-text fallback in smart_outline (#1923)
 *
 * Verifies that files without tree-sitter grammars (.txt, .log, etc.)
 * return non-empty outline output via buildPlainTextFallback.
 */
import { describe, it, expect } from "bun:test";
import { buildPlainTextFallback, formatFoldedView } from "../../src/services/smart-file-read/parser.js";

describe("buildPlainTextFallback", () => {
  it("returns non-empty symbols for a plain .txt file", () => {
    const content = "Hello world\nThis is a plain text file.\nNothing special here.";
    const lines = content.split("\n");
    const result = buildPlainTextFallback(lines, "notes.txt", "unknown");

    expect(result.symbols.length).toBeGreaterThan(0);
    expect(result.totalLines).toBe(3);
    expect(result.filePath).toBe("notes.txt");

    // Should have at least the metadata summary symbol
    const meta = result.symbols.find(s => s.kind === "metadata");
    expect(meta).toBeDefined();
    expect(meta!.signature).toContain("3 lines");
  });

  it("detects ALL-CAPS section headers", () => {
    const content = "INTRODUCTION\n\nSome intro text.\n\nCONCLUSION\n\nFinal thoughts.";
    const lines = content.split("\n");
    const result = buildPlainTextFallback(lines, "doc.txt", "unknown");

    const sections = result.symbols.filter(s => s.kind === "section");
    expect(sections.length).toBe(2);
    expect(sections[0].name).toBe("INTRODUCTION");
    expect(sections[1].name).toBe("CONCLUSION");
  });

  it("detects markdown-style headers in .txt files", () => {
    const content = "# Overview\n\nSome text.\n\n## Details\n\nMore text.";
    const lines = content.split("\n");
    const result = buildPlainTextFallback(lines, "readme.txt", "unknown");

    const sections = result.symbols.filter(s => s.kind === "section");
    expect(sections.length).toBe(2);
    expect(sections[0].name).toBe("Overview");
    expect(sections[1].name).toBe("Details");
  });

  it("detects underline-style section headers", () => {
    const content = "My Section\n-----------\n\nContent here.\n\nAnother Section\n===========\n\nMore content.";
    const lines = content.split("\n");
    const result = buildPlainTextFallback(lines, "doc.txt", "unknown");

    const sections = result.symbols.filter(s => s.kind === "section");
    expect(sections.length).toBe(2);
    expect(sections[0].name).toBe("My Section");
    expect(sections[1].name).toBe("Another Section");
  });

  it("detects [Section Name] style headers", () => {
    const content = "[General]\nkey=value\n\n[Database]\nhost=localhost";
    const lines = content.split("\n");
    const result = buildPlainTextFallback(lines, "config.txt", "unknown");

    const sections = result.symbols.filter(s => s.kind === "section");
    expect(sections.length).toBe(2);
    expect(sections[0].name).toBe("[General]");
    expect(sections[1].name).toBe("[Database]");
  });

  it("returns non-empty output for an empty file", () => {
    const lines = [""];
    const result = buildPlainTextFallback(lines, "empty.txt", "unknown");

    // Even for empty files, should have the metadata summary
    expect(result.symbols.length).toBeGreaterThan(0);
    const meta = result.symbols.find(s => s.kind === "metadata");
    expect(meta).toBeDefined();
  });

  it("produces non-empty formatFoldedView output", () => {
    const content = "CHAPTER ONE\n\nIt was a dark and stormy night.\n\nCHAPTER TWO\n\nThe end.";
    const lines = content.split("\n");
    const result = buildPlainTextFallback(lines, "story.txt", "unknown");

    const folded = formatFoldedView(result);
    expect(folded.length).toBeGreaterThan(0);
    expect(folded).toContain("story.txt");
    expect(folded).toContain("CHAPTER ONE");
    expect(folded).toContain("CHAPTER TWO");
  });

  it("calculates a positive foldedTokenEstimate", () => {
    const content = "Some content\nwith multiple\nlines of text.";
    const lines = content.split("\n");
    const result = buildPlainTextFallback(lines, "file.txt", "unknown");

    expect(result.foldedTokenEstimate).toBeGreaterThan(0);
  });

  it("handles parseFile integration — .txt file returns non-empty symbols", async () => {
    // Import parseFile to test the full integration path
    const { parseFile } = await import("../../src/services/smart-file-read/parser.js");

    const content = "TODO LIST\n=========\n\n1. Fix bugs\n2. Write tests\n3. Ship it";
    const result = parseFile(content, "todo.txt");

    expect(result.symbols.length).toBeGreaterThan(0);
    expect(result.filePath).toBe("todo.txt");

    // Should not return empty symbols anymore (the original bug)
    const hasContent = result.symbols.some(
      s => s.kind === "section" || s.kind === "metadata"
    );
    expect(hasContent).toBe(true);
  });
});
