import { beforeEach, describe, expect, mock, test } from "bun:test";

const getAllSettings = mock(() => ({
	embeddingsEnabled: "true",
}));

const getEffectiveEmbeddingConfig = mock(() => ({
	enabled: true,
	baseUrl: "https://api.example.com",
	apiKey: "",
	model: "emb-model",
	topK: 5,
	maxContextChars: 1000,
	timeoutMs: 1000,
	chunkSize: 1200,
	chunkOverlap: 200,
	batchSize: 16,
}));

const retrieveRelevantChunks = mock(async () => [
	{
		filePath: "src/a.ts",
		chunkSeq: 0,
		chunkText: "const fromChunk = true;",
		offsetStart: 0,
		offsetEnd: 24,
		score: 0.99,
	},
]);

const warn = mock(() => {});

const getDb = mock(() => ({
	prepare: () => ({
		all: () => [
			{
				file_path: "src/a.ts",
				language: "typescript",
				content: "const fromFile = true;",
			},
		],
	}),
}));

mock.module("$lib/server/db/settings.js", () => ({
	getAllSettings,
}));

mock.module("$lib/server/config.js", () => ({
	getEffectiveEmbeddingConfig,
}));

mock.module("$lib/server/embeddings/retrieval.js", () => ({
	retrieveRelevantChunks,
}));

mock.module("$lib/server/logger.js", () => ({
	log: {
		embeddings: { warn },
	},
}));

mock.module("$lib/server/db/index.js", () => ({
	getDb,
}));

import { retrieveContextForPrompt } from "$lib/server/pipeline/retriever.js";

describe("retrieveContextForPrompt", () => {
	beforeEach(() => {
		getAllSettings.mockClear();
		getEffectiveEmbeddingConfig.mockClear();
		retrieveRelevantChunks.mockClear();
		warn.mockClear();
	});

	test("uses embedding chunks when retrieval succeeds", async () => {
		const result = await retrieveContextForPrompt({
			repoId: 1,
			filePaths: ["src/a.ts"],
			queryText: "find a",
		});

		expect(result.source).toBe("embeddings");
		expect(result.codeContext).toContain("const fromChunk = true;");
	});

	test("falls back to full-file retrieval when embedding retrieval fails", async () => {
		retrieveRelevantChunks.mockImplementationOnce(async () => {
			throw new Error("embedding endpoint unavailable");
		});

		const result = await retrieveContextForPrompt({
			repoId: 1,
			filePaths: ["src/a.ts"],
			queryText: "find a",
		});

		expect(result.source).toBe("files");
		expect(result.codeContext).toContain("const fromFile = true;");
		expect(warn).toHaveBeenCalledTimes(1);
	});
});
