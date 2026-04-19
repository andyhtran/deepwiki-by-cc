import { describe, expect, test } from "bun:test";
import { type NormalizerFile, normalizeOutline } from "$lib/server/ai/outline-normalizer.js";
import type { WikiOutline } from "$lib/types.js";

function mkFiles(paths: string[]): NormalizerFile[] {
	return paths.map((p) => ({ filePath: p, language: null }));
}

function mkOutline(pages: { id: string; filePaths: string[]; diagrams?: string[] }[]): WikiOutline {
	return {
		title: "Wiki",
		description: "desc",
		sections: [
			{
				id: "overview",
				title: "Overview",
				description: "Project overview",
				pages: pages.map((p) => ({
					id: p.id,
					title: p.id,
					description: "",
					filePaths: p.filePaths,
					diagrams: p.diagrams,
				})),
			},
		],
	};
}

describe("normalizeOutline", () => {
	test("dedupes exact-match filePaths per page", () => {
		const outline = mkOutline([
			{
				id: "p1",
				filePaths: ["src/index.ts", "src/index.ts", "src/util.ts", "src/util.ts"],
			},
		]);
		const files = mkFiles(["src/index.ts", "src/util.ts"]);
		const result = normalizeOutline(outline, { files });
		expect(result.sections[0].pages[0].filePaths).toEqual(["src/index.ts", "src/util.ts"]);
	});

	test("drops filePaths not present in the files list", () => {
		const outline = mkOutline([
			{ id: "p1", filePaths: ["src/index.ts", "src/hallucinated.ts", "src/util.ts"] },
		]);
		const files = mkFiles(["src/index.ts", "src/util.ts"]);
		const result = normalizeOutline(outline, { files });
		expect(result.sections[0].pages[0].filePaths).toEqual(["src/index.ts", "src/util.ts"]);
	});

	test("clamps to maxFilePathsPerPage", () => {
		const paths = Array.from({ length: 30 }, (_, i) => `src/file${i}.ts`);
		const outline = mkOutline([{ id: "p1", filePaths: paths }]);
		const files = mkFiles(paths);
		const result = normalizeOutline(outline, { files, maxFilePathsPerPage: 10 });
		expect(result.sections[0].pages[0].filePaths.length).toBe(10);
		expect(result.sections[0].pages[0].filePaths[0]).toBe("src/file0.ts");
	});

	test("overview in code-containing repo injects entrypoints when only markdown is assigned", () => {
		const outline = mkOutline([{ id: "overview-page", filePaths: ["README.md"] }]);
		const files = mkFiles(["README.md", "src/index.ts", "src/util.ts"]);
		const result = normalizeOutline(outline, { files });
		const overviewPaths = result.sections[0].pages[0].filePaths;
		expect(overviewPaths).toContain("src/index.ts");
		// README is trimmed when doc ratio exceeds 0.5 (1 doc / 2 files = 0.5, within budget)
	});

	test("overview markdown-only page gets at least one code file after normalization", () => {
		const outline = mkOutline([{ id: "overview-page", filePaths: ["README.md", "CHANGELOG.md"] }]);
		const files = mkFiles(["README.md", "CHANGELOG.md", "src/main.ts", "src/util.ts"]);
		const result = normalizeOutline(outline, { files });
		const overviewPaths = result.sections[0].pages[0].filePaths;
		const hasCode = overviewPaths.some((p) => !p.endsWith(".md"));
		expect(hasCode).toBe(true);
	});

	test("overview doc ratio capped when >50% markdown", () => {
		const outline = mkOutline([
			{
				id: "overview-page",
				filePaths: ["README.md", "docs/a.md", "docs/b.md", "src/index.ts"],
			},
		]);
		const files = mkFiles(["README.md", "docs/a.md", "docs/b.md", "src/index.ts", "src/util.ts"]);
		const result = normalizeOutline(outline, { files });
		const paths = result.sections[0].pages[0].filePaths;
		const docs = paths.filter((p) => p.endsWith(".md"));
		// doc ratio must be <= 0.5
		expect(docs.length / paths.length).toBeLessThanOrEqual(0.5);
		// README should be preserved over other docs
		expect(docs).toContain("README.md");
	});

	test("overview is untouched for docs-only repos", () => {
		const outline = mkOutline([{ id: "overview-page", filePaths: ["README.md", "docs/intro.md"] }]);
		const files = mkFiles(["README.md", "docs/intro.md", "docs/guide.md"]);
		const result = normalizeOutline(outline, { files });
		expect(result.sections[0].pages[0].filePaths).toEqual(["README.md", "docs/intro.md"]);
	});

	test("low-complexity page (<= 2 filePaths) has diagrams cleared", () => {
		const outline: WikiOutline = {
			title: "Wiki",
			description: "desc",
			sections: [
				{
					id: "details",
					title: "Details",
					description: "",
					pages: [
						{
							id: "p1",
							title: "P1",
							description: "",
							filePaths: ["src/util.ts"],
							diagrams: ["flow", "class"],
						},
					],
				},
			],
		};
		const files = mkFiles(["src/util.ts", "src/other.ts"]);
		const result = normalizeOutline(outline, { files });
		expect(result.sections[0].pages[0].diagrams).toEqual([]);
	});

	test("page diagram suggestions capped at 2", () => {
		const outline: WikiOutline = {
			title: "Wiki",
			description: "desc",
			sections: [
				{
					id: "details",
					title: "Details",
					description: "",
					pages: [
						{
							id: "p1",
							title: "P1",
							description: "",
							filePaths: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
							diagrams: ["architecture", "flow", "class", "sequence"],
						},
					],
				},
			],
		};
		const files = mkFiles(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]);
		const result = normalizeOutline(outline, { files });
		expect(result.sections[0].pages[0].diagrams?.length).toBe(2);
	});

	test("preserves Overview as the first section", () => {
		const outline: WikiOutline = {
			title: "Wiki",
			description: "desc",
			sections: [
				{
					id: "overview",
					title: "Overview",
					description: "",
					pages: [{ id: "overview-page", title: "Overview", description: "", filePaths: [] }],
				},
				{
					id: "components",
					title: "Components",
					description: "",
					pages: [{ id: "c1", title: "C1", description: "", filePaths: ["src/util.ts"] }],
				},
			],
		};
		const files = mkFiles(["README.md", "src/index.ts", "src/util.ts"]);
		const result = normalizeOutline(outline, { files });
		expect(result.sections[0].id).toBe("overview");
		expect(result.sections[0].title).toBe("Overview");
		// Overview should have entrypoint(s) injected since it had no code files.
		expect(result.sections[0].pages[0].filePaths.length).toBeGreaterThan(0);
		expect(result.sections[0].pages[0].filePaths).toContain("src/index.ts");
	});

	test("is idempotent", () => {
		const outline = mkOutline([
			{
				id: "overview-page",
				filePaths: ["README.md", "docs/a.md", "docs/b.md", "src/index.ts"],
				diagrams: ["flow", "class", "sequence"],
			},
		]);
		const files = mkFiles(["README.md", "docs/a.md", "docs/b.md", "src/index.ts", "src/util.ts"]);
		const once = normalizeOutline(outline, { files });
		const twice = normalizeOutline(once, { files });
		expect(twice).toEqual(once);
	});
});
