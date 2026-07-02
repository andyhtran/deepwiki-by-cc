import { describe, expect, test } from "bun:test";
import {
	buildWikiCorpus,
	computeCitationStats,
	computeCoreFileCoverage,
	computeMermaidStats,
	computeSizeStats,
	type EvalPage,
	extractPathCandidates,
} from "../evals/lib.js";

function page(overrides: Partial<EvalPage>): EvalPage {
	return {
		pageId: "p1",
		title: "Page",
		section: "Overview",
		status: "completed",
		content: "",
		...overrides,
	};
}

describe("extractPathCandidates", () => {
	test("extracts repo paths from inline code spans", () => {
		const content = "The scanner lives in `src/lib/server/pipeline/scanner.ts` and walks the tree.";
		expect(extractPathCandidates(content)).toEqual(["src/lib/server/pipeline/scanner.ts"]);
	});

	test("strips line references and leading ./ or /", () => {
		const content = "See `src/lib/server/config.ts:42` and `./package.json` and `/src/app.html`.";
		expect(extractPathCandidates(content)).toEqual([
			"package.json",
			"src/app.html",
			"src/lib/server/config.ts",
		]);
	});

	test("ignores method calls and property accesses that look like extensions", () => {
		const content = "Call `db.pragma` then `log.info` and read `config.dataDir` and `pLimit(2)`.";
		expect(extractPathCandidates(content)).toEqual([]);
	});

	test("ignores unknown extensions like .db and .lock", () => {
		const content = "Data lives in `data/deepwiki.db`, deps in `bun.lock`.";
		expect(extractPathCandidates(content)).toEqual([]);
	});

	test("ignores never-scanned paths like build artifacts and lock files", () => {
		const content =
			"Production runs `build/index.js`; the scanner skips `package-lock.json` and `credentials.json`.";
		expect(extractPathCandidates(content)).toEqual([]);
	});

	test("ignores leading-dot extension globs and dotfiles", () => {
		const content = "The scanner skips `.min.js` and `.min.css` files and reads `.gitignore`.";
		expect(extractPathCandidates(content)).toEqual([]);
	});

	test("extracts paths from GitHub blob links", () => {
		const content =
			"[worker](https://github.com/foo/bar/blob/main/src/lib/server/queue/worker.ts#L10)";
		expect(extractPathCandidates(content)).toEqual(["src/lib/server/queue/worker.ts"]);
	});

	test("extracts relative markdown link targets but skips external URLs and anchors", () => {
		const content =
			"[a](src/lib/types.ts) [b](https://example.com/foo.ts) [c](#section) [d](docs/guide.md)";
		expect(extractPathCandidates(content)).toEqual(["docs/guide.md", "src/lib/types.ts"]);
	});

	test("ignores code spans with spaces or shell commands", () => {
		const content = "Run `bun run dev` or `git clone repo.git target/dir.ts`.";
		expect(extractPathCandidates(content)).toEqual([]);
	});
});

describe("computeCitationStats", () => {
	test("splits candidates into valid and invalid against the repo file list", () => {
		const pages = [
			page({ content: "See `src/real.ts` and `src/fake.ts` for details." }),
			page({ pageId: "p2", content: "Also `src/real.ts` again." }),
		];
		const stats = computeCitationStats(pages, ["src/real.ts"]);
		expect(stats.candidateCount).toBe(2);
		expect(stats.validCount).toBe(1);
		expect(stats.invalidPaths).toEqual(["src/fake.ts"]);
		expect(stats.validity).toBeCloseTo(0.5);
	});

	test("returns null validity when there are no candidates", () => {
		const stats = computeCitationStats([page({ content: "No paths here." })], ["src/real.ts"]);
		expect(stats.validity).toBeNull();
	});

	test("accepts bare basenames that match a real repo file", () => {
		const pages = [page({ content: "See `real.ts` and `phantom.ts` for details." })];
		const stats = computeCitationStats(pages, ["src/deep/real.ts"]);
		expect(stats.validCount).toBe(1);
		expect(stats.invalidPaths).toEqual(["phantom.ts"]);
	});

	test("accepts trailing path fragments of real files", () => {
		const pages = [page({ content: "See `deep/real.ts` and `queue/handlers.ts`." })];
		const stats = computeCitationStats(pages, [
			"src/deep/real.ts",
			"src/lib/server/queue/handlers.ts",
		]);
		expect(stats.validCount).toBe(2);
		expect(stats.invalidPaths).toEqual([]);
	});

	test("rejects slash candidates whose tail matches no repo file", () => {
		const pages = [page({ content: "See `wrong/dir/real.ts`." })];
		const stats = computeCitationStats(pages, ["src/deep/real.ts"]);
		expect(stats.invalidPaths).toEqual(["wrong/dir/real.ts"]);
	});
});

describe("computeCoreFileCoverage", () => {
	test("counts core files mentioned anywhere, including prose", () => {
		const pages = [
			page({ content: "The queue handler src/lib/server/queue/handlers.ts drives generation." }),
		];
		const coverage = computeCoreFileCoverage(pages, [
			"src/lib/server/queue/handlers.ts",
			"src/lib/server/pipeline/scanner.ts",
		]);
		expect(coverage.covered).toEqual(["src/lib/server/queue/handlers.ts"]);
		expect(coverage.missing).toEqual(["src/lib/server/pipeline/scanner.ts"]);
		expect(coverage.coverage).toBeCloseTo(0.5);
	});
});

describe("computeMermaidStats", () => {
	test("counts total fences and validates diagram types", () => {
		const content = [
			"```mermaid",
			"graph TD",
			'    A["a"] --> B["b"]',
			"```",
			"",
			"```mermaid",
			"notarealtype",
			"whatever",
			"```",
		].join("\n");
		const stats = computeMermaidStats([page({ content })]);
		expect(stats.total).toBe(2);
		expect(stats.valid).toBe(1);
	});

	test("ignores mermaid mentions in inline code spans and quoted code blocks", () => {
		const content = [
			"The policy scans for ` ```mermaid ` fences in the markdown.",
			"",
			"```ts",
			"const regex = /```mermaid\\n([\\s\\S]*?)```/g;",
			"const label = '```mermaid';",
			"```",
			"",
			"```mermaid",
			"sequenceDiagram",
			"    A->>B: hi",
			"```",
		].join("\n");
		const stats = computeMermaidStats([page({ content })]);
		expect(stats.total).toBe(1);
		expect(stats.valid).toBe(1);
	});
});

describe("computeSizeStats", () => {
	test("aggregates sections, statuses, and word counts", () => {
		const pages = [
			page({ content: "one two three" }),
			page({ pageId: "p2", section: "Internals", content: "four five" }),
			page({ pageId: "p3", section: "Internals", status: "failed", content: null }),
		];
		const stats = computeSizeStats(pages);
		expect(stats.sections).toBe(2);
		expect(stats.pages).toBe(3);
		expect(stats.completedPages).toBe(2);
		expect(stats.failedPages).toBe(1);
		expect(stats.totalWords).toBe(5);
		expect(stats.avgWordsPerPage).toBe(3);
	});
});

describe("buildWikiCorpus", () => {
	test("includes only completed pages and marks truncation", () => {
		const pages = [
			page({ title: "Alpha", content: "alpha content" }),
			page({ pageId: "p2", title: "Beta", status: "failed", content: "should not appear" }),
		];
		const { corpus, truncated } = buildWikiCorpus(pages, 10_000);
		expect(corpus).toContain("# Alpha");
		expect(corpus).toContain("alpha content");
		expect(corpus).not.toContain("should not appear");
		expect(truncated).toBe(false);
	});

	test("truncates over the budget", () => {
		const pages = [page({ content: "x".repeat(500) })];
		const { corpus, truncated } = buildWikiCorpus(pages, 100);
		expect(truncated).toBe(true);
		expect(corpus).toContain("[wiki content truncated for evaluation]");
	});
});
