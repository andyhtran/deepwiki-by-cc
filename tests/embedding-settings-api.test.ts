import { beforeEach, describe, expect, mock, test } from "bun:test";

const setSetting = mock((_key: string, _value: string) => {});
const getAllSettings = mock(() => ({
	embeddingsEnabled: "true",
	embeddingsBaseUrl: "https://api.openai.com",
	embeddingsModel: "text-embedding-3-small",
	embeddingsTopK: "8",
	embeddingsMaxContextChars: "12000",
	embeddingsTimeoutMs: "20000",
	embeddingsChunkSize: "1200",
	embeddingsChunkOverlap: "200",
	embeddingsBatchSize: "32",
}));

mock.module("$lib/server/db/settings.js", () => ({
	setSetting,
	getAllSettings,
}));

import { GET, PUT } from "../src/routes/api/settings/embeddings/+server.js";

function makeRequest(body: Record<string, unknown>): Request {
	return new Request("http://localhost/api/settings/embeddings", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("embeddings settings API", () => {
	beforeEach(() => {
		setSetting.mockClear();
		getAllSettings.mockClear();
	});

	test("GET returns effective embedding settings", async () => {
		const response = await GET({} as never);
		expect(response.status).toBe(200);

		const payload = await response.json();
		expect(payload.current.enabled).toBe(true);
		expect(payload.current.model).toBe("text-embedding-3-small");
	});

	test("PUT validates and persists valid settings", async () => {
		const response = await PUT({
			request: makeRequest({
				enabled: true,
				baseUrl: "https://example.com",
				apiKey: "secret-key",
				model: "my-embedding-model",
				topK: 6,
				maxContextChars: 9000,
				timeoutMs: 15000,
				chunkSize: 1000,
				chunkOverlap: 100,
				batchSize: 20,
			}),
		} as never);
		expect(response.status).toBe(200);
		expect(setSetting.mock.calls).toEqual([
			["embeddingsEnabled", "true"],
			["embeddingsBaseUrl", "https://example.com"],
			["embeddingsApiKey", "secret-key"],
			["embeddingsModel", "my-embedding-model"],
			["embeddingsTopK", "6"],
			["embeddingsMaxContextChars", "9000"],
			["embeddingsTimeoutMs", "15000"],
			["embeddingsChunkSize", "1000"],
			["embeddingsChunkOverlap", "100"],
			["embeddingsBatchSize", "20"],
		]);
	});

	test("PUT rejects invalid payloads", async () => {
		const response = await PUT({
			request: makeRequest({
				baseUrl: "not-a-url",
				topK: 0,
				chunkSize: 100,
				chunkOverlap: 500,
			}),
		} as never);
		expect(response.status).toBe(400);
		expect(setSetting).not.toHaveBeenCalled();
	});
});
