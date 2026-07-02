import { describe, expect, test } from "bun:test";
import { buildOutlinePrompt } from "$lib/server/prompts/outline.js";
import { buildPagePrompt } from "$lib/server/prompts/page.js";
import { buildUpdatePrompt, NO_CHANGES_SENTINEL } from "$lib/server/prompts/update.js";

describe("buildOutlinePrompt", () => {
	const baseParams = {
		repoName: "acme/widget",
		fileTree: "src/\n  index.ts\n  utils.ts",
		readme: "# Widget\nA widget library.",
		fileCount: 2,
		languages: ["typescript"],
	};

	test("includes repo name", () => {
		const prompt = buildOutlinePrompt(baseParams);
		expect(prompt).toContain("acme/widget");
	});

	test("includes file tree", () => {
		const prompt = buildOutlinePrompt(baseParams);
		expect(prompt).toContain("src/\n  index.ts\n  utils.ts");
	});

	test("includes file count", () => {
		const prompt = buildOutlinePrompt(baseParams);
		expect(prompt).toContain("2 files");
	});

	test("includes readme when present", () => {
		const prompt = buildOutlinePrompt(baseParams);
		expect(prompt).toContain("### README");
		expect(prompt).toContain("A widget library.");
	});

	test("excludes readme section when null", () => {
		const prompt = buildOutlinePrompt({ ...baseParams, readme: null });
		expect(prompt).not.toContain("### README");
	});

	test("includes languages", () => {
		const prompt = buildOutlinePrompt({
			...baseParams,
			languages: ["typescript", "python"],
		});
		expect(prompt).toContain("typescript, python");
	});

	test("includes JSON format instructions", () => {
		const prompt = buildOutlinePrompt(baseParams);
		expect(prompt).toContain('"sections"');
		expect(prompt).toContain('"filePaths"');
		expect(prompt).toContain("Return ONLY the JSON object");
	});

	test("keeps Overview-first instruction", () => {
		const prompt = buildOutlinePrompt(baseParams);
		expect(prompt).toContain('The first section should always be "Overview"');
	});

	test("uses neutral evidence wording for code-vs-docs", () => {
		const prompt = buildOutlinePrompt(baseParams);
		expect(prompt).toContain("observable behavior in the source");
		expect(prompt).toContain("supporting context");
	});

	test("omits leak-prone phrasing about source of truth / trust hierarchy", () => {
		const prompt = buildOutlinePrompt(baseParams);
		expect(prompt).not.toContain("Source-trust hierarchy");
		expect(prompt).not.toContain("source of truth");
		expect(prompt).not.toContain("trust the code");
		expect(prompt).not.toContain("Code First");
	});
});

describe("buildPagePrompt", () => {
	const baseParams = {
		repoName: "acme/widget",
		pageTitle: "Architecture Overview",
		pageDescription: "Explains the high-level architecture",
		sectionTitle: "Overview",
		seedFilePaths: ["src/index.ts", "src/utils.ts"],
		suggestedDiagrams: ["architecture", "flow"],
		outline: "- Overview\n  - Architecture Overview",
	};

	test("includes section and page title", () => {
		const prompt = buildPagePrompt(baseParams);
		expect(prompt).toContain("**Section**: Overview");
		expect(prompt).toContain("**Page**: Architecture Overview");
	});

	test("includes page description and repo name", () => {
		const prompt = buildPagePrompt(baseParams);
		expect(prompt).toContain("Explains the high-level architecture");
		expect(prompt).toContain("acme/widget");
	});

	test("lists seed files and frames them as starting points", () => {
		const prompt = buildPagePrompt(baseParams);
		expect(prompt).toContain("- src/index.ts");
		expect(prompt).toContain("- src/utils.ts");
		expect(prompt).toContain("starting points, not boundaries");
	});

	test("instructs exploration with read-only tools", () => {
		const prompt = buildPagePrompt(baseParams);
		expect(prompt).toContain("file-reading and search tools");
		expect(prompt).toContain("follow imports");
		expect(prompt).toContain("callers and consumers");
	});

	test("handles empty seed file list", () => {
		const prompt = buildPagePrompt({ ...baseParams, seedFilePaths: [] });
		expect(prompt).toContain("discover the relevant files yourself");
	});

	test("includes diagram instructions when diagrams suggested", () => {
		const prompt = buildPagePrompt(baseParams);
		expect(prompt).toContain("architecture, flow");
		expect(prompt).toContain("Mermaid diagrams");
		expect(prompt).toContain("```mermaid");
	});

	test("excludes diagram section when no diagrams", () => {
		const prompt = buildPagePrompt({ ...baseParams, suggestedDiagrams: [] });
		expect(prompt).not.toContain("Mermaid diagrams");
	});

	test("includes outline context", () => {
		const prompt = buildPagePrompt(baseParams);
		expect(prompt).toContain("- Overview\n  - Architecture Overview");
	});

	test("uses neutral wording for docs-vs-code and forbids meta headings", () => {
		const prompt = buildPagePrompt(baseParams);
		expect(prompt).toContain("describe what the code actually does");
		expect(prompt).toContain("documentation methodology or prompt policy");
		expect(prompt).toContain("Code First");
		expect(prompt).toContain("Source of Truth");
	});

	test("omits leak-prone 'prefer the code' / 'source of truth' phrasing", () => {
		const prompt = buildPagePrompt(baseParams);
		expect(prompt).not.toContain("prefer the code");
		expect(prompt).not.toContain("source of truth");
		expect(prompt).not.toContain("Trust Hierarchy:");
	});
});

describe("buildUpdatePrompt", () => {
	const baseParams = {
		repoName: "acme/widget",
		changeTitle: "Add caching layer",
		changeDescription: "This adds Redis caching to the API endpoints.",
		changeDiff: `diff --git a/src/cache.ts b/src/cache.ts
+import Redis from 'ioredis';
+const redis = new Redis();`,
		currentPageContent: "# Architecture\n\nThe system uses a simple request/response model.",
		pageTitle: "Architecture Overview",
		seedFilePaths: ["src/cache.ts", "src/api.ts"],
		outline: "- Overview\n  - Architecture Overview",
		outputMode: "schema" as const,
	};

	test("includes change title and description", () => {
		const prompt = buildUpdatePrompt(baseParams);
		expect(prompt).toContain("Add caching layer");
		expect(prompt).toContain("Redis caching to the API endpoints");
	});

	test("includes diff in code block", () => {
		const prompt = buildUpdatePrompt(baseParams);
		expect(prompt).toContain("```diff");
		expect(prompt).toContain("+import Redis from 'ioredis'");
	});

	test("includes current page content and title", () => {
		const prompt = buildUpdatePrompt(baseParams);
		expect(prompt).toContain("simple request/response model");
		expect(prompt).toContain("## Current Wiki Page: Architecture Overview");
	});

	test("lists the page's source files as exploration seeds", () => {
		const prompt = buildUpdatePrompt(baseParams);
		expect(prompt).toContain("- src/cache.ts");
		expect(prompt).toContain("- src/api.ts");
	});

	test("instructs agentic verification against the checkout", () => {
		const prompt = buildUpdatePrompt(baseParams);
		expect(prompt).toContain("the diff shows the delta, the checkout is the truth");
		expect(prompt).toContain("Re-verify the page's existing claims");
	});

	test("schema mode includes noChangesNeeded instructions", () => {
		const prompt = buildUpdatePrompt(baseParams);
		expect(prompt).toContain("noChangesNeeded");
		expect(prompt).not.toContain(NO_CHANGES_SENTINEL);
	});

	test("final-message mode uses the sentinel instead of the schema", () => {
		const prompt = buildUpdatePrompt({ ...baseParams, outputMode: "final-message" });
		expect(prompt).toContain(NO_CHANGES_SENTINEL);
		expect(prompt).not.toContain("noChangesNeeded");
	});

	test("truncates diff at 50K chars", () => {
		const longDiff = "x".repeat(60_000);
		const prompt = buildUpdatePrompt({ ...baseParams, changeDiff: longDiff });
		const diffMatch = prompt.match(/```diff\n([\s\S]*?)```/);
		expect(diffMatch).toBeDefined();
		expect(diffMatch![1].length).toBeLessThanOrEqual(50_001);
	});

	test("includes repo name", () => {
		const prompt = buildUpdatePrompt(baseParams);
		expect(prompt).toContain("acme/widget");
	});

	test("forbids methodology/meta headings", () => {
		const prompt = buildUpdatePrompt(baseParams);
		expect(prompt).toContain("documentation methodology or prompt policy");
		expect(prompt).toContain("Code First");
		expect(prompt).toContain("Trust Hierarchy");
	});
});
