import { describe, expect, test } from "bun:test";
import { extractJson } from "$lib/server/ai/generator.js";

describe("extractJson", () => {
	test("returns clean JSON unchanged", () => {
		const input = '{"title": "Hello"}';
		expect(extractJson(input)).toBe('{"title": "Hello"}');
	});

	test("strips markdown code fences", () => {
		const input = '```json\n{"title": "Hello"}\n```';
		expect(extractJson(input)).toBe('{"title": "Hello"}');
	});

	test("strips code fences without json tag", () => {
		const input = '```\n{"title": "Hello"}\n```';
		expect(extractJson(input)).toBe('{"title": "Hello"}');
	});

	test("extracts JSON from surrounding prose", () => {
		const input = 'Here is the JSON:\n{"title": "Hello"}\nThat was the JSON.';
		expect(extractJson(input)).toBe('{"title": "Hello"}');
	});

	test("handles nested braces", () => {
		const input = '{"outer": {"inner": "value"}}';
		const result = extractJson(input);
		expect(JSON.parse(result)).toEqual({ outer: { inner: "value" } });
	});

	test("trims whitespace", () => {
		const input = '  \n  {"title": "Hello"}  \n  ';
		expect(extractJson(input)).toBe('{"title": "Hello"}');
	});

	test("handles empty input", () => {
		expect(extractJson("")).toBe("");
	});

	test("returns original text when no braces found", () => {
		expect(extractJson("no json here")).toBe("no json here");
	});
});
