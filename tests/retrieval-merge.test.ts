import { describe, expect, test } from "bun:test";
import { mergeAndDedupeChunks, type RetrievedChunk } from "$lib/server/embeddings/retrieval.js";

function makeChunk(
	filePath: string,
	chunkSeq: number,
	score: number,
	textLen: number = 100,
): RetrievedChunk {
	return {
		filePath,
		chunkSeq,
		chunkText: `chunk-${filePath}-${chunkSeq}-`.padEnd(textLen, "x"),
		offsetStart: chunkSeq * textLen,
		offsetEnd: (chunkSeq + 1) * textLen,
		score,
	};
}

describe("mergeAndDedupeChunks", () => {
	test("deduplicates by filePath+chunkSeq, keeping higher score", () => {
		const primary = [makeChunk("a.ts", 0, 0.8)];
		const secondary = [makeChunk("a.ts", 0, 0.9)];
		const merged = mergeAndDedupeChunks(primary, secondary, 100_000);
		expect(merged.length).toBe(1);
		expect(merged[0].score).toBe(0.9);
	});

	test("merges distinct chunks from both sources", () => {
		const primary = [makeChunk("a.ts", 0, 0.9)];
		const secondary = [makeChunk("b.ts", 0, 0.85)];
		const merged = mergeAndDedupeChunks(primary, secondary, 100_000);
		expect(merged.length).toBe(2);
		expect(merged[0].filePath).toBe("a.ts");
		expect(merged[1].filePath).toBe("b.ts");
	});

	test("sorts by score descending", () => {
		const primary = [makeChunk("a.ts", 0, 0.5)];
		const secondary = [makeChunk("b.ts", 0, 0.9), makeChunk("c.ts", 0, 0.7)];
		const merged = mergeAndDedupeChunks(primary, secondary, 100_000);
		expect(merged[0].filePath).toBe("b.ts");
		expect(merged[1].filePath).toBe("c.ts");
		expect(merged[2].filePath).toBe("a.ts");
	});

	test("respects maxContextChars budget", () => {
		const chunks = Array.from({ length: 10 }, (_, i) =>
			makeChunk(`file${i}.ts`, 0, 0.9 - i * 0.05, 200),
		);
		const merged = mergeAndDedupeChunks(chunks, [], 500);
		// Should fit about 2-3 chunks within 500 chars
		expect(merged.length).toBeLessThanOrEqual(3);
		const totalChars = merged.reduce((s, c) => s + c.chunkText.length, 0);
		expect(totalChars).toBeLessThanOrEqual(500 + 50); // Allow for truncation message
	});

	test("handles empty inputs", () => {
		expect(mergeAndDedupeChunks([], [], 10000)).toEqual([]);
		const chunks = [makeChunk("a.ts", 0, 0.9)];
		expect(mergeAndDedupeChunks(chunks, [], 10000).length).toBe(1);
		expect(mergeAndDedupeChunks([], chunks, 10000).length).toBe(1);
	});
});
