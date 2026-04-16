import { describe, expect, test } from "bun:test";
import { chunkTextDeterministic } from "$lib/server/embeddings/chunker.js";

describe("chunkTextDeterministic", () => {
	test("returns stable chunk boundaries for same input", () => {
		const content = [
			"# Title",
			"",
			"First paragraph with enough text to force chunking.".repeat(6),
			"",
			"Second paragraph with additional words and structure.".repeat(6),
			"",
			"Third paragraph.".repeat(6),
		].join("\n");

		const runA = chunkTextDeterministic(content, { chunkSize: 240, chunkOverlap: 60 });
		const runB = chunkTextDeterministic(content, { chunkSize: 240, chunkOverlap: 60 });

		expect(runA).toEqual(runB);
		expect(runA.length).toBeGreaterThan(1);
		expect(runA[0].offsetStart).toBe(0);
	});

	test("enforces overlap while always moving forward", () => {
		const content = "x".repeat(1000);
		const chunks = chunkTextDeterministic(content, { chunkSize: 240, chunkOverlap: 80 });
		expect(chunks.length).toBeGreaterThan(3);

		for (let i = 1; i < chunks.length; i++) {
			expect(chunks[i].offsetStart).toBeGreaterThan(chunks[i - 1].offsetStart);
			expect(chunks[i].offsetStart).toBeLessThan(chunks[i - 1].offsetEnd);
		}
	});

	test("drops whitespace-only chunks", () => {
		const content = "\n\n\n \n\t\n";
		const chunks = chunkTextDeterministic(content, { chunkSize: 10, chunkOverlap: 2 });
		expect(chunks).toEqual([]);
	});
});
