import { describe, expect, test } from "bun:test";
import { config, getEffectiveConfig } from "$lib/server/config.js";

describe("getEffectiveConfig", () => {
	test("returns defaults when settings are empty", () => {
		const result = getEffectiveConfig({});
		expect(result.generationModel).toBe(config.generationModel);
		expect(result.parallelPageLimit).toBe(config.parallelPageLimit);
	});

	test("uses custom model when provided", () => {
		const result = getEffectiveConfig({ generationModel: "claude-opus-4-6" });
		expect(result.generationModel).toBe("claude-opus-4-6");
	});

	test("falls back to default model for empty string", () => {
		const result = getEffectiveConfig({ generationModel: "" });
		expect(result.generationModel).toBe(config.generationModel);
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
});
