import { describe, expect, test } from "bun:test";
import type { ScannedFile } from "$lib/server/pipeline/scanner.js";
import { buildFileTree } from "$lib/server/pipeline/scanner.js";

describe("buildFileTree", () => {
	function file(filePath: string): ScannedFile {
		return {
			filePath,
			language: null,
			content: "",
			contentHash: "",
			sizeBytes: 0,
			lineCount: 0,
		};
	}

	test("renders flat files", () => {
		const tree = buildFileTree([file("README.md"), file("package.json")]);
		expect(tree).toBe("package.json\nREADME.md");
	});

	test("renders nested directories", () => {
		const tree = buildFileTree([file("src/index.ts"), file("src/lib/utils.ts")]);
		expect(tree).toContain("src/");
		expect(tree).toContain("  lib/");
		expect(tree).toContain("    utils.ts");
		expect(tree).toContain("  index.ts");
	});

	test("sorts directories before files", () => {
		const tree = buildFileTree([file("src/index.ts"), file("README.md"), file("src/lib/utils.ts")]);
		const lines = tree.split("\n");
		// src/ directory should come before README.md file
		const srcIdx = lines.findIndex((l) => l.startsWith("src/"));
		const readmeIdx = lines.indexOf("README.md");
		expect(srcIdx).toBeLessThan(readmeIdx);
	});

	test("handles empty file list", () => {
		expect(buildFileTree([])).toBe("");
	});
});
