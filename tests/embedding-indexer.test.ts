import { describe, expect, test } from "bun:test";
import { selectFilesNeedingEmbeddingRefresh } from "$lib/server/embeddings/indexer.js";
import type { ScannedFile } from "$lib/server/pipeline/scanner.js";

function file(path: string, hash: string): ScannedFile {
	return {
		filePath: path,
		language: "typescript",
		content: `// ${path}`,
		contentHash: hash,
		sizeBytes: 10,
		lineCount: 1,
	};
}

describe("selectFilesNeedingEmbeddingRefresh", () => {
	test("skips unchanged files that already have embeddings for current hash", () => {
		const files = [file("src/a.ts", "hash-a"), file("src/b.ts", "hash-b")];
		const coverage = new Map<string, Set<string>>([
			["src/a.ts", new Set(["hash-a"])],
			["src/b.ts", new Set(["older-hash"])],
		]);

		const selected = selectFilesNeedingEmbeddingRefresh(files, coverage);
		expect(selected.map((f) => f.filePath)).toEqual(["src/b.ts"]);
	});

	test("returns all files when no embedding coverage exists", () => {
		const files = [file("src/a.ts", "hash-a"), file("src/b.ts", "hash-b")];
		const selected = selectFilesNeedingEmbeddingRefresh(files, new Map());
		expect(selected.map((f) => f.filePath)).toEqual(["src/a.ts", "src/b.ts"]);
	});
});
