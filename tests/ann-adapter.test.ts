import { describe, expect, mock, test } from "bun:test";

// Mock the DB and retrieval dependencies
const mockChunkEmbeddings = [
	{
		chunkId: 1,
		repoId: 1,
		filePath: "src/a.ts",
		contentHash: "hash-a",
		chunkSeq: 0,
		chunkText: "alpha content",
		offsetStart: 0,
		offsetEnd: 13,
		embedding: [1, 0, 0],
		embeddingModel: "emb-model",
		endpointFingerprint: "fp",
	},
	{
		chunkId: 2,
		repoId: 1,
		filePath: "src/b.ts",
		contentHash: "hash-b",
		chunkSeq: 0,
		chunkText: "bravo content",
		offsetStart: 0,
		offsetEnd: 13,
		embedding: [0, 1, 0],
		embeddingModel: "emb-model",
		endpointFingerprint: "fp",
	},
	{
		chunkId: 3,
		repoId: 1,
		filePath: "src/c.ts",
		contentHash: "hash-c",
		chunkSeq: 0,
		chunkText: "charlie content",
		offsetStart: 0,
		offsetEnd: 15,
		embedding: [0, 0, 1],
		embeddingModel: "emb-model",
		endpointFingerprint: "fp",
	},
];

mock.module("$lib/server/db/embeddings.js", () => ({
	getChunkEmbeddingsForRepo: () => mockChunkEmbeddings,
	getChunkEmbeddingsForFiles: () => [],
	getEmbeddedHashesByFile: () => new Map(),
	deleteEmbeddingDataByPaths: () => {},
	replaceFileEmbeddings: () => {},
}));

// ann.ts imports config for dataDir, but searchAnn only uses the passed-in params.
// We mock the logger to avoid file-system side effects from log initialization.
mock.module("$lib/server/logger.js", () => ({
	log: {
		retrieval: { info: () => {}, debug: () => {}, warn: () => {} },
	},
}));

import { searchAnn } from "$lib/server/embeddings/ann.js";

describe("searchAnn (exact cosine fallback)", () => {
	test("returns top-K results sorted by score", () => {
		const results = searchAnn({
			repoId: 1,
			embeddingModel: "emb-model",
			endpointFingerprint: "fp",
			queryVector: [1, 0, 0],
			topK: 2,
		});

		expect(results.length).toBe(2);
		expect(results[0].filePath).toBe("src/a.ts");
		expect(results[0].score).toBeCloseTo(1, 4);
		expect(results[1].score).toBeLessThan(results[0].score);
	});

	test("returns exact match with score 1.0", () => {
		const results = searchAnn({
			repoId: 1,
			embeddingModel: "emb-model",
			endpointFingerprint: "fp",
			queryVector: [0, 0, 1],
			topK: 1,
		});

		expect(results.length).toBe(1);
		expect(results[0].filePath).toBe("src/c.ts");
		expect(results[0].score).toBeCloseTo(1, 4);
	});

	test("returns orthogonal results with score 0", () => {
		const results = searchAnn({
			repoId: 1,
			embeddingModel: "emb-model",
			endpointFingerprint: "fp",
			queryVector: [1, 0, 0],
			topK: 3,
		});

		// First result should be score ~1, others should be ~0
		expect(results[0].score).toBeCloseTo(1, 4);
		expect(results[1].score).toBeCloseTo(0, 4);
		expect(results[2].score).toBeCloseTo(0, 4);
	});

	test("respects topK limit", () => {
		const results = searchAnn({
			repoId: 1,
			embeddingModel: "emb-model",
			endpointFingerprint: "fp",
			queryVector: [0.5, 0.5, 0.5],
			topK: 1,
		});
		expect(results.length).toBe(1);
	});
});
