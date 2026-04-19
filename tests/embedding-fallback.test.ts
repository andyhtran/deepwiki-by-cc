import { beforeEach, describe, expect, mock, test } from "bun:test";

// Force constrained mode so this test's "1 chunk, score 0.99" scenario
// doesn't trip the (now default) hybrid_auto weakness fallback — which would
// require mocking global retrieval as well. We deliberately DO NOT mock
// $lib/server/config.js: Bun's mock.module is process-wide and not
// auto-restored between files, and a partial replacement of config.js here
// used to leak a stub of getEffectiveEmbeddingConfig into later suites
// (e.g. embedding-settings-api) and break them. Letting the real config run
// against a controlled settings bag is enough — `enabled: true` is the only
// behavior this test depends on; the rest are defaults.
const getAllSettings = mock(() => ({
	embeddingsEnabled: "true",
	retrievalModeGeneration: "constrained",
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
