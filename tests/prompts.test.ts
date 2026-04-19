import { describe, expect, test } from "bun:test";
import { buildOutlinePrompt } from "$lib/server/prompts/outline.js";
import { buildPagePrompt } from "$lib/server/prompts/page.js";
import { buildUpdatePrompt } from "$lib/server/prompts/update.js";

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
		codeContext: "```typescript\nconst x = 1;\n```",
		suggestedDiagrams: ["architecture", "flow"],
		outline: "- Overview\n  - Architecture Overview",
	};

	test("includes section and page title", () => {
		const prompt = buildPagePrompt(baseParams);
		expect(prompt).toContain("**Section**: Overview");
		expect(prompt).toContain("**Page**: Architecture Overview");
	});

	test("includes page description", () => {
		const prompt = buildPagePrompt(baseParams);
		expect(prompt).toContain("Explains the high-level architecture");
	});

	test("includes code context", () => {
		const prompt = buildPagePrompt(baseParams);
		expect(prompt).toContain("const x = 1;");
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

	test("includes repo name", () => {
		const prompt = buildPagePrompt(baseParams);
		expect(prompt).toContain("acme/widget");
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
		updatedCodeContext: "```typescript\nconst redis = new Redis();\n```",
	};

	test("includes change title", () => {
		const prompt = buildUpdatePrompt(baseParams);
		expect(prompt).toContain("Add caching layer");
	});

	test("includes change description", () => {
		const prompt = buildUpdatePrompt(baseParams);
		expect(prompt).toContain("Redis caching to the API endpoints");
	});

	test("includes diff in code block", () => {
		const prompt = buildUpdatePrompt(baseParams);
		expect(prompt).toContain("```diff");
		expect(prompt).toContain("+import Redis from 'ioredis'");
	});

	test("includes current page content", () => {
		const prompt = buildUpdatePrompt(baseParams);
		expect(prompt).toContain("simple request/response model");
	});

	test("includes noChangesNeeded instruction", () => {
		const prompt = buildUpdatePrompt(baseParams);
		expect(prompt).toContain("noChangesNeeded");
	});

	test("includes updated code context", () => {
		const prompt = buildUpdatePrompt(baseParams);
		expect(prompt).toContain("const redis = new Redis()");
	});

	test("truncates diff at 50K chars", () => {
		const longDiff = "x".repeat(60_000);
		const prompt = buildUpdatePrompt({ ...baseParams, changeDiff: longDiff });
		// The diff is sliced to 50_000 chars inside the template
		// The prompt should not contain all 60K chars
		expect(prompt.length).toBeLessThan(baseParams.changeDiff.length + 60_000);
		// Verify the truncation: the diff portion should be at most 50K
		const diffMatch = prompt.match(/```diff\n([\s\S]*?)```/);
		expect(diffMatch).toBeDefined();
		expect(diffMatch![1].length).toBeLessThanOrEqual(50_001); // 50K + newline
	});

	test("includes page title", () => {
		const prompt = buildUpdatePrompt(baseParams);
		expect(prompt).toContain("## Current Wiki Page: Architecture Overview");
	});

	test("includes repo name", () => {
		const prompt = buildUpdatePrompt(baseParams);
		expect(prompt).toContain("## Repository: acme/widget");
	});

	test("forbids methodology/meta headings", () => {
		const prompt = buildUpdatePrompt(baseParams);
		expect(prompt).toContain("documentation methodology or prompt policy");
		expect(prompt).toContain("Code First");
		expect(prompt).toContain("Trust Hierarchy");
	});
});
