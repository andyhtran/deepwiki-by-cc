import { describe, expect, test } from "bun:test";
import { calculateCost } from "$lib/server/config.js";

describe("calculateCost", () => {
	test("calculates cost for Sonnet 4.6 model", () => {
		const cost = calculateCost("claude-sonnet-4-6", 1000, 1000);
		// input: 1000/1000 * 0.003 = 0.003
		// output: 1000/1000 * 0.015 = 0.015
		expect(cost).toBeCloseTo(0.018);
	});

	test("calculates cost for Opus 4.6 model", () => {
		const cost = calculateCost("claude-opus-4-6", 1000, 1000);
		// input: 1000/1000 * 0.005 = 0.005
		// output: 1000/1000 * 0.025 = 0.025
		expect(cost).toBeCloseTo(0.03);
	});

	test("returns 0 for unknown models", () => {
		const cost = calculateCost("unknown-model", 1000, 1000);
		expect(cost).toBe(0);
	});

	test("returns 0 for non-priced codex model", () => {
		const cost = calculateCost("codex-gpt-5-3-xhigh", 1000, 1000);
		expect(cost).toBe(0);
	});

	test("handles zero tokens", () => {
		const cost = calculateCost("claude-sonnet-4-6", 0, 0);
		expect(cost).toBe(0);
	});

	test("handles large token counts", () => {
		const cost = calculateCost("claude-sonnet-4-6", 100000, 50000);
		// input: 100000/1000 * 0.003 = 0.3
		// output: 50000/1000 * 0.015 = 0.75
		expect(cost).toBeCloseTo(1.05);
	});
});
