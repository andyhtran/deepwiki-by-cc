import { describe, expect, test } from "bun:test";
import { buildOutlineSummary, validateOutline } from "$lib/server/ai/generator.js";
import type { WikiOutline } from "$lib/types.js";

const validOutline: WikiOutline = {
	title: "Test Wiki",
	description: "A test wiki",
	sections: [
		{
			id: "overview",
			title: "Overview",
			description: "Project overview",
			pages: [
				{
					id: "intro",
					title: "Introduction",
					description: "Getting started",
					filePaths: ["README.md"],
				},
			],
		},
	],
};

describe("validateOutline", () => {
	test("accepts a valid outline", () => {
		expect(() => validateOutline(validOutline)).not.toThrow();
	});

	test("throws when title is missing", () => {
		const outline = { ...validOutline, title: "" };
		expect(() => validateOutline(outline)).toThrow("missing title");
	});

	test("throws when sections is not an array", () => {
		const outline = { ...validOutline, sections: "not-array" } as any;
		expect(() => validateOutline(outline)).toThrow("missing sections array");
	});

	test("throws when sections is missing", () => {
		const outline = { title: "Test" } as any;
		expect(() => validateOutline(outline)).toThrow("missing sections array");
	});

	test("throws when section is missing id", () => {
		const outline: WikiOutline = {
			...validOutline,
			sections: [{ id: "", title: "Section", description: "desc", pages: [] }],
		};
		expect(() => validateOutline(outline)).toThrow("Invalid section");
	});

	test("throws when section is missing title", () => {
		const outline: WikiOutline = {
			...validOutline,
			sections: [{ id: "s1", title: "", description: "desc", pages: [] }],
		};
		expect(() => validateOutline(outline)).toThrow("Invalid section");
	});

	test("throws when section pages is not an array", () => {
		const outline = {
			...validOutline,
			sections: [{ id: "s1", title: "Section", description: "desc", pages: "not-array" }],
		} as any;
		expect(() => validateOutline(outline)).toThrow("missing pages array");
	});

	test("throws when page is missing id", () => {
		const outline: WikiOutline = {
			...validOutline,
			sections: [
				{
					id: "s1",
					title: "Section",
					description: "desc",
					pages: [{ id: "", title: "Page", description: "desc", filePaths: [] }],
				},
			],
		};
		expect(() => validateOutline(outline)).toThrow("Invalid page");
	});

	test("throws when page is missing title", () => {
		const outline: WikiOutline = {
			...validOutline,
			sections: [
				{
					id: "s1",
					title: "Section",
					description: "desc",
					pages: [{ id: "p1", title: "", description: "desc", filePaths: [] }],
				},
			],
		};
		expect(() => validateOutline(outline)).toThrow("Invalid page");
	});

	test("accepts outline with empty sections array", () => {
		const outline: WikiOutline = { ...validOutline, sections: [] };
		expect(() => validateOutline(outline)).not.toThrow();
	});

	test("accepts section with empty pages array", () => {
		const outline: WikiOutline = {
			...validOutline,
			sections: [{ id: "s1", title: "Section", description: "desc", pages: [] }],
		};
		expect(() => validateOutline(outline)).not.toThrow();
	});
});

describe("buildOutlineSummary", () => {
	test("formats a single section with one page", () => {
		const result = buildOutlineSummary(validOutline);
		expect(result).toContain("**Overview**");
		expect(result).toContain("- Introduction: Getting started");
	});

	test("formats multiple sections", () => {
		const outline: WikiOutline = {
			title: "Wiki",
			description: "desc",
			sections: [
				{
					id: "s1",
					title: "First",
					description: "desc",
					pages: [{ id: "p1", title: "Page A", description: "Desc A", filePaths: [] }],
				},
				{
					id: "s2",
					title: "Second",
					description: "desc",
					pages: [{ id: "p2", title: "Page B", description: "Desc B", filePaths: [] }],
				},
			],
		};
		const result = buildOutlineSummary(outline);
		expect(result).toContain("**First**");
		expect(result).toContain("**Second**");
		expect(result).toContain("Page A: Desc A");
		expect(result).toContain("Page B: Desc B");
	});

	test("returns empty string for empty sections", () => {
		const outline: WikiOutline = { title: "Wiki", description: "desc", sections: [] };
		expect(buildOutlineSummary(outline)).toBe("");
	});
});
