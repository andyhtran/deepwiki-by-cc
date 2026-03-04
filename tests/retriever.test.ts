import { describe, expect, test } from "bun:test";
import { type FileContent, formatFilesForContext } from "$lib/server/pipeline/retriever.js";

function makeFile(
	filePath: string,
	content: string,
	language: string | null = "typescript",
): FileContent {
	return { filePath, language, content };
}

describe("formatFilesForContext", () => {
	test("formats files with headers and code blocks", () => {
		const files = [makeFile("src/a.ts", "const a = 1;"), makeFile("src/b.ts", "const b = 2;")];
		const result = formatFilesForContext(files);
		expect(result).toContain("### src/a.ts");
		expect(result).toContain("### src/b.ts");
		expect(result).toContain("const a = 1;");
		expect(result).toContain("const b = 2;");
	});

	test("wraps in markdown code blocks with language tags", () => {
		const files = [makeFile("src/main.py", "def hello(): pass", "python")];
		const result = formatFilesForContext(files);
		expect(result).toContain("```python");
		expect(result).toContain("def hello(): pass");
		expect(result).toContain("```");
	});

	test("uses empty language tag when language is null", () => {
		const files = [makeFile("README.md", "# Hello", null)];
		const result = formatFilesForContext(files);
		expect(result).toContain("```\n# Hello");
	});

	test("truncates at 100K characters and lists omitted files", () => {
		const longText = "x".repeat(20_000);
		const files: FileContent[] = [];
		for (let i = 0; i < 10; i++) {
			files.push(makeFile(`src/file${i}.ts`, longText));
		}
		const result = formatFilesForContext(files);
		expect(result).toContain("... (context truncated)");
		expect(result).toContain("Files omitted due to context limit:");

		// The first 100k of content is preserved, plus the truncation notice and file list
		const truncationIdx = result.indexOf("... (context truncated)");
		expect(truncationIdx).toBeLessThanOrEqual(100_000 + 5);
	});

	test("handles empty input", () => {
		const result = formatFilesForContext([]);
		expect(result).toBe("");
	});

	test("preserves file ordering", () => {
		const files = [makeFile("src/a.ts", "first"), makeFile("src/b.ts", "second")];
		const result = formatFilesForContext(files);
		const firstIdx = result.indexOf("first");
		const secondIdx = result.indexOf("second");
		expect(firstIdx).toBeLessThan(secondIdx);
	});
});
