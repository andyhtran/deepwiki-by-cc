import { describe, expect, test } from "bun:test";
import { config, getEffectiveRetrievalConfig } from "$lib/server/config.js";

describe("getEffectiveRetrievalConfig", () => {
	test("returns defaults when settings are empty", () => {
		const result = getEffectiveRetrievalConfig({});
		expect(result.generation.mode).toBe("hybrid_auto");
		expect(result.generation.topK).toBe(config.embeddingTopK);
		expect(result.generation.maxContextChars).toBe(config.embeddingMaxContextChars);
	});

	test("parses custom retrieval mode", () => {
		const result = getEffectiveRetrievalConfig({
			retrievalModeGeneration: "constrained",
		});
		expect(result.generation.mode).toBe("constrained");
	});

	test("falls back to default for invalid retrieval mode", () => {
		const result = getEffectiveRetrievalConfig({
			retrievalModeGeneration: "invalid_mode",
		});
		expect(result.generation.mode).toBe("hybrid_auto");
	});

	test("parses weakness thresholds", () => {
		const result = getEffectiveRetrievalConfig({
			weaknessMinChunks: "5",
			weaknessMinContextChars: "8000",
			weaknessMinTopScore: "0.4",
			weaknessMinScoreGap: "0.1",
		});
		expect(result.weakness.minChunks).toBe(5);
		expect(result.weakness.minContextChars).toBe(8000);
		expect(result.weakness.minTopScore).toBeCloseTo(0.4, 4);
		expect(result.weakness.minScoreGap).toBeCloseTo(0.1, 4);
	});

	test("clamps weakness thresholds to valid ranges", () => {
		const result = getEffectiveRetrievalConfig({
			weaknessMinChunks: "50",
			weaknessMinTopScore: "2.0",
			weaknessMinScoreGap: "-1",
		});
		expect(result.weakness.minChunks).toBe(20);
		expect(result.weakness.minTopScore).toBe(1);
		expect(result.weakness.minScoreGap).toBe(0);
	});

	test("handles non-numeric values gracefully", () => {
		const result = getEffectiveRetrievalConfig({
			weaknessMinTopScore: "not-a-number",
		});
		expect(result.weakness.minTopScore).toBe(config.weaknessMinTopScore);
	});

	test("generation topK uses existing embedding settings", () => {
		const result = getEffectiveRetrievalConfig({
			embeddingsTopK: "15",
			embeddingsMaxContextChars: "25000",
		});
		expect(result.generation.topK).toBe(15);
		expect(result.generation.maxContextChars).toBe(25000);
	});
});
