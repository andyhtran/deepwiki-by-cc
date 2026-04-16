import { beforeEach, describe, expect, mock, test } from "bun:test";

const getChunkEmbeddingsForFiles = mock(() => [
	{
		chunkId: 1,
		repoId: 5,
		filePath: "src/a.ts",
		contentHash: "hash-a",
		chunkSeq: 0,
		chunkText: "alpha",
		offsetStart: 0,
		offsetEnd: 5,
		embedding: [1, 0],
		embeddingModel: "emb-model",
		endpointFingerprint: "fp",
	},
	{
		chunkId: 2,
		repoId: 5,
		filePath: "src/b.ts",
		contentHash: "hash-b",
		chunkSeq: 0,
		chunkText: "bravo",
		offsetStart: 0,
		offsetEnd: 5,
		embedding: [0, 1],
		embeddingModel: "emb-model",
		endpointFingerprint: "fp",
	},
]);

const createEmbeddings = mock(async () => ({
	embeddings: [[0.8, 0.2]],
	providerModel: "emb-model",
}));

mock.module("$lib/server/db/embeddings.js", () => ({
	getChunkEmbeddingsForFiles,
}));

mock.module("$lib/server/embeddings/client.js", () => ({
	createEmbeddings,
	createEndpointFingerprint: () => "fp",
}));

import { cosineSimilarity, retrieveRelevantChunks } from "$lib/server/embeddings/retrieval.js";

describe("cosineSimilarity", () => {
	test("returns expected values for matching and orthogonal vectors", () => {
		expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
		expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
	});
});

describe("retrieveRelevantChunks", () => {
	beforeEach(() => {
		getChunkEmbeddingsForFiles.mockClear();
		createEmbeddings.mockClear();
	});

	test("ranks chunks by cosine score and returns top-k", async () => {
		const chunks = await retrieveRelevantChunks({
			repoId: 5,
			filePaths: ["src/a.ts", "src/b.ts"],
			queryText: "find alpha",
			embeddingConfig: {
				enabled: true,
				baseUrl: "https://api.example.com",
				apiKey: "",
				model: "emb-model",
				topK: 1,
				maxContextChars: 1000,
				timeoutMs: 1000,
				chunkSize: 1200,
				chunkOverlap: 200,
				batchSize: 16,
			},
		});

		expect(chunks.length).toBe(1);
		expect(chunks[0].filePath).toBe("src/a.ts");
		expect(chunks[0].score).toBeGreaterThan(0.9);
	});

	test("respects maxContextChars", async () => {
		getChunkEmbeddingsForFiles.mockImplementationOnce(() => [
			{
				chunkId: 10,
				repoId: 5,
				filePath: "src/long.ts",
				contentHash: "hash-long",
				chunkSeq: 0,
				chunkText: "x".repeat(500),
				offsetStart: 0,
				offsetEnd: 500,
				embedding: [1, 0],
				embeddingModel: "emb-model",
				endpointFingerprint: "fp",
			},
		]);
		createEmbeddings.mockImplementationOnce(async () => ({
			embeddings: [[1, 0]],
			providerModel: "emb-model",
		}));

		const chunks = await retrieveRelevantChunks({
			repoId: 5,
			filePaths: ["src/long.ts"],
			queryText: "long",
			embeddingConfig: {
				enabled: true,
				baseUrl: "https://api.example.com",
				apiKey: "",
				model: "emb-model",
				topK: 5,
				maxContextChars: 120,
				timeoutMs: 1000,
				chunkSize: 1200,
				chunkOverlap: 200,
				batchSize: 16,
			},
		});

		expect(chunks.length).toBe(1);
		expect(chunks[0].chunkText.length).toBeLessThanOrEqual(160);
	});
});
