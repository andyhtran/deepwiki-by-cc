import { describe, expect, test } from "bun:test";
import {
	config,
	getEffectiveConfig,
	getGenerationModel,
	isGenerationModel,
} from "$lib/server/config.js";

describe("getEffectiveConfig", () => {
	test("returns defaults when settings are empty", () => {
		const result = getEffectiveConfig({});
		expect(result.generationModel).toBe(config.generationModel);
		expect(result.parallelPageLimit).toBe(config.parallelPageLimit);
		expect(result.display.showRepoOwner).toBe(config.showRepoOwner);
		expect(result.embeddings.enabled).toBe(config.embeddingEnabled);
		expect(result.embeddings.model).toBe(config.embeddingModel);
	});

	test("uses custom model when provided", () => {
		const result = getEffectiveConfig({ generationModel: "claude-opus-4-6" });
		expect(result.generationModel).toBe("claude-opus-4-6");
	});

	test("uses codex model when provided", () => {
		const medium = getEffectiveConfig({ generationModel: "gpt-5.5" });
		const xhigh = getEffectiveConfig({ generationModel: "gpt-5.5-xhigh" });
		expect(medium.generationModel).toBe("gpt-5.5");
		expect(xhigh.generationModel).toBe("gpt-5.5-xhigh");
	});

	test("falls back to default model for empty string", () => {
		const result = getEffectiveConfig({ generationModel: "" });
		expect(result.generationModel).toBe(config.generationModel);
	});

	test("falls back to default model for invalid model id", () => {
		const result = getEffectiveConfig({ generationModel: "not-a-real-model" });
		expect(result.generationModel).toBe(config.generationModel);
	});

	test("validates known generation model ids", () => {
		expect(isGenerationModel("claude-sonnet-4-6")).toBe(true);
		expect(isGenerationModel("claude-opus-4-6")).toBe(true);
		expect(isGenerationModel("gpt-5.5")).toBe(true);
		expect(isGenerationModel("gpt-5.5-xhigh")).toBe(true);
		expect(isGenerationModel("invalid-model")).toBe(false);
	});

	test("configures gpt-5.5 with medium and xhigh reasoning", () => {
		expect(getGenerationModel("gpt-5.5")).toMatchObject({
			cliModel: "gpt-5.5",
			reasoningEffort: "medium",
		});
		expect(getGenerationModel("gpt-5.5-xhigh")).toMatchObject({
			cliModel: "gpt-5.5",
			reasoningEffort: "xhigh",
		});
	});

	test("parses valid parallelPageLimit", () => {
		const result = getEffectiveConfig({ parallelPageLimit: "3" });
		expect(result.parallelPageLimit).toBe(3);
	});

	test("clamps parallelPageLimit to minimum of 1", () => {
		const result = getEffectiveConfig({ parallelPageLimit: "0" });
		expect(result.parallelPageLimit).toBe(1);
	});

	test("clamps negative parallelPageLimit to 1", () => {
		const result = getEffectiveConfig({ parallelPageLimit: "-5" });
		expect(result.parallelPageLimit).toBe(1);
	});

	test("clamps parallelPageLimit to maximum of 5", () => {
		const result = getEffectiveConfig({ parallelPageLimit: "10" });
		expect(result.parallelPageLimit).toBe(5);
	});

	test("returns default for non-numeric parallelPageLimit", () => {
		const result = getEffectiveConfig({ parallelPageLimit: "abc" });
		expect(result.parallelPageLimit).toBe(config.parallelPageLimit);
	});

	test("parses embedding settings with bounds", () => {
		const result = getEffectiveConfig({
			embeddingsEnabled: "true",
			embeddingsBaseUrl: "https://example.com",
			embeddingsModel: "custom-model",
			embeddingsTopK: "999",
			embeddingsMaxContextChars: "50",
			embeddingsTimeoutMs: "abc",
		});
		expect(result.embeddings.enabled).toBe(true);
		expect(result.embeddings.baseUrl).toBe("https://example.com");
		expect(result.embeddings.model).toBe("custom-model");
		expect(result.embeddings.topK).toBe(30);
		expect(result.embeddings.maxContextChars).toBe(1000);
		expect(result.embeddings.timeoutMs).toBe(config.embeddingRequestTimeoutMs);
	});

	test("parses display settings", () => {
		expect(getEffectiveConfig({ showRepoOwner: "false" }).display.showRepoOwner).toBe(false);
		expect(getEffectiveConfig({ showRepoOwner: "true" }).display.showRepoOwner).toBe(true);
		expect(getEffectiveConfig({ showRepoOwner: "invalid" }).display.showRepoOwner).toBe(
			config.showRepoOwner,
		);
	});
});
