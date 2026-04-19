import { describe, expect, test } from "bun:test";
import { sanitizeLeakyHeadings, stripLeadingTitleHeading } from "$lib/server/ai/generator.js";
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

	test("returns correct cost for codex model", () => {
		const cost = calculateCost("codex-gpt-5-3-xhigh", 1000, 1000);
		// input: 1.75/1k tokens, output: 14.0/1k tokens → (1000/1000)*1.75/1000 + (1000/1000)*14.0/1000
		expect(cost).toBeCloseTo(0.01575, 5);
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

describe("stripLeadingTitleHeading", () => {
	test("strips a matching leading H1 followed by a blank line", () => {
		const input = "# Keyboard UI, Input Modes, and Swipe Engine\n\n## Introduction\nBody.";
		const out = stripLeadingTitleHeading(input, "Keyboard UI, Input Modes, and Swipe Engine");
		expect(out).toBe("## Introduction\nBody.");
	});

	test("is case- and whitespace-insensitive when comparing the title", () => {
		const input = "#   keyboard ui,  input modes, and swipe engine  \n\n## Body";
		const out = stripLeadingTitleHeading(input, "Keyboard UI, Input Modes, and Swipe Engine");
		expect(out).toBe("## Body");
	});

	test("leaves non-matching leading H1s alone", () => {
		const input = "# Something Else\n\n## Body";
		const out = stripLeadingTitleHeading(input, "Keyboard UI");
		expect(out).toBe(input);
	});

	test("leaves content starting with H2 untouched", () => {
		const input = "## Introduction\nBody.";
		const out = stripLeadingTitleHeading(input, "Whatever");
		expect(out).toBe(input);
	});

	test("handles empty/null-ish input without throwing", () => {
		expect(stripLeadingTitleHeading("", "Title")).toBe("");
	});
});

describe("sanitizeLeakyHeadings", () => {
	test("removes H2 meta-policy headings and their trailing blank line", () => {
		const input = [
			"Intro paragraph.",
			"",
			"## Code First",
			"",
			"This section leaks policy wording.",
			"",
			"## Repos Table",
			"Body.",
		].join("\n");
		const out = sanitizeLeakyHeadings(input);
		expect(out).not.toContain("Code First");
		expect(out).toContain("## Repos Table");
		expect(out).toContain("This section leaks policy wording.");
	});

	test("removes H3 meta-policy headings regardless of capitalization and punctuation", () => {
		const input = ["### Source of Truth", "body1", "", "### Trust Hierarchy:", "body2"].join("\n");
		const out = sanitizeLeakyHeadings(input);
		expect(out).not.toContain("Source of Truth");
		expect(out).not.toContain("Trust Hierarchy");
		expect(out).toContain("body1");
		expect(out).toContain("body2");
	});

	test("also matches 'Code vs Docs' and 'Docs vs Code' variants", () => {
		const input = "## Code vs Docs\n\nsome prose\n\n## Docs vs. Code\n\nmore prose";
		const out = sanitizeLeakyHeadings(input);
		expect(out).not.toContain("Code vs Docs");
		expect(out).not.toContain("Docs vs. Code");
		expect(out).toContain("some prose");
		expect(out).toContain("more prose");
	});

	test("normalizes a whole-inline-code heading", () => {
		const input = "## `repos`\nBody.";
		const out = sanitizeLeakyHeadings(input);
		expect(out).toContain("## repos");
		expect(out).not.toContain("## `repos`");
	});

	test("leaves mixed prose+code headings alone", () => {
		const input = "## The `repos` Table\nBody.";
		const out = sanitizeLeakyHeadings(input);
		expect(out).toContain("## The `repos` Table");
	});

	test("leaves normal feature headings alone", () => {
		const input = "## Architecture Overview\nBody.";
		const out = sanitizeLeakyHeadings(input);
		expect(out).toBe(input);
	});

	test("does not touch content inside fenced code blocks", () => {
		const input = [
			"## Real Heading",
			"",
			"```markdown",
			"## Code First",
			"## `repos`",
			"```",
			"",
			"## Source of Truth",
			"leaked",
		].join("\n");
		const out = sanitizeLeakyHeadings(input);
		// Fenced block content is preserved verbatim
		expect(out).toContain("## Code First\n## `repos`");
		// The real meta heading outside the fence is still removed
		expect(out.split("```")[2]).not.toContain("## Source of Truth");
		expect(out).toContain("leaked");
	});

	test("leaves H1 headings alone (title handled elsewhere)", () => {
		const input = "# Code First\nBody.";
		const out = sanitizeLeakyHeadings(input);
		expect(out).toBe(input);
	});

	test("handles empty input", () => {
		expect(sanitizeLeakyHeadings("")).toBe("");
	});
});
