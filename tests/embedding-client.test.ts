import { describe, expect, test } from "bun:test";
import {
	buildEmbeddingsEndpoint,
	createEndpointFingerprint,
} from "../src/lib/server/embeddings/client.js";

describe("buildEmbeddingsEndpoint", () => {
	test("appends /v1/embeddings for plain base URLs", () => {
		expect(buildEmbeddingsEndpoint("https://api.openai.com")).toBe(
			"https://api.openai.com/v1/embeddings",
		);
	});

	test("appends /embeddings for /v1 URLs", () => {
		expect(buildEmbeddingsEndpoint("https://api.openai.com/v1")).toBe(
			"https://api.openai.com/v1/embeddings",
		);
	});

	test("keeps full embedding endpoints unchanged", () => {
		expect(buildEmbeddingsEndpoint("https://api.openai.com/v1/embeddings")).toBe(
			"https://api.openai.com/v1/embeddings",
		);
		expect(buildEmbeddingsEndpoint("https://proxy.local/openai/v1/embeddings")).toBe(
			"https://proxy.local/openai/v1/embeddings",
		);
	});

	test("fingerprint treats base, /v1, and /v1/embeddings as same endpoint", () => {
		const base = createEndpointFingerprint("https://api.openai.com");
		const v1 = createEndpointFingerprint("https://api.openai.com/v1");
		const full = createEndpointFingerprint("https://api.openai.com/v1/embeddings");

		expect(v1).toBe(base);
		expect(full).toBe(base);
	});
});
