import { describe, expect, test } from "bun:test";
import { chunkTextDeterministic } from "$lib/server/embeddings/chunker.js";

describe("token-aware chunking", () => {
	test("produces chunks with tokenCount field", () => {
		const content = "Hello world. ".repeat(200);
		const chunks = chunkTextDeterministic(content, {
			tokenAware: true,
			targetTokens: 100,
			overlapTokens: 20,
		});
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.tokenCount).toBeGreaterThan(0);
			expect(typeof chunk.tokenCount).toBe("number");
		}
	});

	test("char-based chunking also includes tokenCount", () => {
		const content = "function hello() { return 42; }\n".repeat(50);
		const chunks = chunkTextDeterministic(content, { chunkSize: 300, chunkOverlap: 50 });
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.tokenCount).toBeGreaterThan(0);
		}
	});

	test("token-aware chunks respect target token count approximately", () => {
		const content = "The quick brown fox jumps over the lazy dog. ".repeat(500);
		const targetTokens = 200;
		const chunks = chunkTextDeterministic(content, {
			tokenAware: true,
			targetTokens,
			overlapTokens: 30,
		});
		expect(chunks.length).toBeGreaterThan(2);

		// Most chunks should be within 50% of target (accounting for boundary adjustments)
		const withinRange = chunks.filter(
			(c) => c.tokenCount >= targetTokens * 0.5 && c.tokenCount <= targetTokens * 1.5,
		);
		// At least 70% of chunks should be in range (last chunk may be smaller)
		expect(withinRange.length / chunks.length).toBeGreaterThan(0.7);
	});

	test("token-aware chunking preserves boundary-aware splitting", () => {
		const content = [
			"First paragraph with some text here.",
			"",
			"Second paragraph with different content.",
			"",
			"Third paragraph to ensure multiple chunks.",
		]
			.join("\n")
			.repeat(20);

		const chunks = chunkTextDeterministic(content, {
			tokenAware: true,
			targetTokens: 50,
			overlapTokens: 10,
		});

		// Chunks should prefer paragraph boundaries
		const endsWithNewline = chunks.filter(
			(c) => c.chunkText.endsWith("\n") || c.chunkText.endsWith("\n\n"),
		);
		// At least some chunks should end at paragraph boundaries
		expect(endsWithNewline.length).toBeGreaterThan(0);
	});

	test("token-aware chunks always make forward progress", () => {
		const content = "x".repeat(2000);
		const chunks = chunkTextDeterministic(content, {
			tokenAware: true,
			targetTokens: 100,
			overlapTokens: 30,
		});
		expect(chunks.length).toBeGreaterThan(1);

		for (let i = 1; i < chunks.length; i++) {
			expect(chunks[i].offsetStart).toBeGreaterThan(chunks[i - 1].offsetStart);
		}
	});

	test("token-aware drops whitespace-only chunks", () => {
		const content = "\n\n\n \n\t\n";
		const chunks = chunkTextDeterministic(content, {
			tokenAware: true,
			targetTokens: 50,
			overlapTokens: 10,
		});
		expect(chunks).toEqual([]);
	});

	test("empty text returns no chunks in token-aware mode", () => {
		const chunks = chunkTextDeterministic("", {
			tokenAware: true,
			targetTokens: 100,
		});
		expect(chunks).toEqual([]);
	});
});
