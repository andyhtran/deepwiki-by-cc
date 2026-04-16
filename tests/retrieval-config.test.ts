import { describe, expect, test } from "bun:test";
import { config, getEffectiveRetrievalConfig } from "$lib/server/config.js";

describe("getEffectiveRetrievalConfig", () => {
	test("returns defaults when settings are empty", () => {
		const result = getEffectiveRetrievalConfig({});
		expect(result.generation.mode).toBe("constrained");
		expect(result.mcp.mode).toBe("hybrid_auto");
		expect(result.generation.topK).toBe(config.embeddingTopK);
		expect(result.generation.maxContextChars).toBe(config.embeddingMaxContextChars);
		expect(result.mcp.topK).toBe(config.mcpTopK);
		expect(result.mcp.maxContextChars).toBe(config.mcpMaxContextChars);
	});

	test("parses custom retrieval modes", () => {
		const result = getEffectiveRetrievalConfig({
			retrievalModeGeneration: "hybrid_auto",
			retrievalModeMcp: "constrained",
		});
		expect(result.generation.mode).toBe("hybrid_auto");
		expect(result.mcp.mode).toBe("constrained");
	});

	test("falls back to default for invalid retrieval mode", () => {
		const result = getEffectiveRetrievalConfig({
			retrievalModeGeneration: "invalid_mode",
			retrievalModeMcp: "also_invalid",
		});
		expect(result.generation.mode).toBe("constrained");
		expect(result.mcp.mode).toBe("hybrid_auto");
	});

	test("parses MCP topK and maxContextChars", () => {
		const result = getEffectiveRetrievalConfig({
			mcpTopK: "30",
			mcpMaxContextChars: "50000",
		});
		expect(result.mcp.topK).toBe(30);
		expect(result.mcp.maxContextChars).toBe(50000);
	});

	test("clamps MCP topK to bounds", () => {
		const result = getEffectiveRetrievalConfig({ mcpTopK: "100" });
		expect(result.mcp.topK).toBe(50);
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
			mcpTopK: "abc",
			weaknessMinTopScore: "not-a-number",
		});
		expect(result.mcp.topK).toBe(config.mcpTopK);
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
