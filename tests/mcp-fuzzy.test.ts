import { describe, expect, test } from "bun:test";
import { didYouMean, levenshtein } from "../src/mcp/fuzzy";

describe("levenshtein", () => {
	test("returns 0 for equal strings", () => {
		expect(levenshtein("NanoVoice", "NanoVoice")).toBe(0);
	});

	test("returns length when one side is empty", () => {
		expect(levenshtein("", "abc")).toBe(3);
		expect(levenshtein("abc", "")).toBe(3);
	});

	test("counts single-character edits", () => {
		expect(levenshtein("NanoVice", "NanoVoice")).toBe(1);
		expect(levenshtein("nanovox", "nanovoice")).toBe(3);
	});
});

describe("didYouMean", () => {
	const wikis = [
		"aliang-fyi/NanoVoice",
		"aliang-fyi/NanoVox",
		"aliang-fyi/NanoVoiceMac",
		"aliang-fyi/search-gateway",
		"aliang-fyi/audio-flow",
		"andyhtran/deepwiki-by-cc",
	];

	test("returns empty array for empty query or candidates", () => {
		expect(didYouMean("", wikis)).toEqual([]);
		expect(didYouMean("NanoVoice", [])).toEqual([]);
	});

	test("ranks substring matches first, case-insensitively", () => {
		const result = didYouMean("nano", wikis);
		expect(result).toContain("aliang-fyi/NanoVoice");
		expect(result).toContain("aliang-fyi/NanoVox");
		expect(result).toContain("aliang-fyi/NanoVoiceMac");
		expect(result).toHaveLength(3);
	});

	test("catches typos via Levenshtein distance", () => {
		// 'NanoVice' is 1 edit from 'NanoVoice' — should surface even though
		// the candidate also contains 'aliang-fyi/' prefix.
		const result = didYouMean("aliang-fyi/NanoVice", wikis);
		expect(result[0]).toBe("aliang-fyi/NanoVoice");
	});

	test("respects the limit", () => {
		expect(didYouMean("nano", wikis, 2)).toHaveLength(2);
		expect(didYouMean("nano", wikis, 1)).toHaveLength(1);
	});

	test("returns empty when nothing is close enough", () => {
		const result = didYouMean("xyzzy-something-unrelated", wikis);
		expect(result).toEqual([]);
	});

	test("substring ranks ahead of closer edit distance", () => {
		// 'audio' is a substring of 'aliang-fyi/audio-flow' even though
		// 'aliang-fyi/NanoVox' has a closer Levenshtein distance.
		const result = didYouMean("audio", wikis);
		expect(result[0]).toBe("aliang-fyi/audio-flow");
	});

	test("tolerates proportional edits on long identifiers", () => {
		// Page-ID-style candidates ~40 chars. A 20-edit miss should still
		// surface when the ratio is ≤ 0.5, so a structural guess surfaces
		// the closest real page.
		const pageIds = [
			"audio-capture-and-transcription-pipeline",
			"dictation-lifecycle-end-to-end",
			"keyboard-extension-ui-and-swipe",
			"engine-implementations",
		];
		const result = didYouMean("audio-caturee-pipeline", pageIds);
		expect(result[0]).toBe("audio-capture-and-transcription-pipeline");
	});

	test("does not match totally unrelated long identifiers", () => {
		const pageIds = [
			"audio-capture-and-transcription-pipeline",
			"dictation-lifecycle-end-to-end",
			"keyboard-extension-ui-and-swipe",
		];
		expect(didYouMean("xyzzy-unrelated-thing", pageIds)).toEqual([]);
	});
});
