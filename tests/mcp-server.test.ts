import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHandlers, type DbLike, type Handlers } from "../src/mcp/server";

// In-memory test DB seeded with a small fixture wiki. We use bun:sqlite (the
// existing test convention) and pass it to createHandlers via the structural
// DbLike interface — no coupling to better-sqlite3 in tests.
function schemaPath(): string {
	return join(dirname(new URL(import.meta.url).pathname), "../src/lib/server/db/schema.sql");
}

function setupDb(): Database {
	const d = new Database(":memory:");
	d.exec("PRAGMA journal_mode = WAL;");
	d.exec("PRAGMA foreign_keys = ON;");
	const schema = readFileSync(schemaPath(), "utf-8");
	const statements = schema
		.split(";")
		.map((s) => s.trim())
		.filter((s) => s.length > 0 && !s.startsWith("PRAGMA"));
	for (const stmt of statements) d.exec(`${stmt};`);
	return d;
}

const SAMPLE_CONTENT_NO_DIAGRAM =
	"# Overview\n\nThis page explains the overview.\n\n## Details\n\nMore details here.";
const SAMPLE_CONTENT_WITH_DIAGRAM =
	"# Architecture\n\nIntro paragraph.\n\n```mermaid\ngraph TD\n  A-->B\n```\n\nAfter the diagram.";

interface SeedOpts {
	owner?: string;
	repo?: string;
	commitSha?: string | null;
	model?: string;
	updatedAt?: string;
	pages?: Array<{
		pageId: string;
		title: string;
		parentId: string | null;
		sortOrder: number;
		content: string | null;
		diagrams?: string[];
		filePaths?: string[];
	}>;
	sections?: Array<{ id: string; title: string; pages: { id: string; title: string }[] }>;
}

function seedWiki(d: Database, opts: SeedOpts = {}): { wikiId: number; repoId: number } {
	const owner = opts.owner ?? "andyhtran";
	const repo = opts.repo ?? "deepwiki-by-cc";
	const fullName = `${owner}/${repo}`;
	const commitSha = opts.commitSha ?? "1357b4f0123456789abcdef0123456789abcdef01";
	const model = opts.model ?? "claude-sonnet";

	const pages = opts.pages ?? [
		{
			pageId: "overview",
			title: "Overview",
			parentId: "intro",
			sortOrder: 0,
			content: SAMPLE_CONTENT_NO_DIAGRAM,
			filePaths: ["src/index.ts"],
		},
		{
			pageId: "architecture",
			title: "Architecture",
			parentId: "intro",
			sortOrder: 1,
			content: SAMPLE_CONTENT_WITH_DIAGRAM,
			diagrams: ["graph TD\n  A-->B"],
			filePaths: ["src/mcp/server.ts"],
		},
	];

	const sections = opts.sections ?? [
		{
			id: "intro",
			title: "Introduction",
			pages: pages
				.filter((p) => p.parentId === "intro")
				.map((p) => ({ id: p.pageId, title: p.title })),
		},
	];

	const repoRow = d
		.prepare(
			`INSERT INTO repos (owner, name, full_name, url, default_branch, last_commit_sha)
			 VALUES (?, ?, ?, ?, 'main', ?)
			 RETURNING id`,
		)
		.get(owner, repo, fullName, `https://github.com/${fullName}`, commitSha) as { id: number };

	const structure = JSON.stringify({ sections });
	const wikiInsertSql = opts.updatedAt
		? `INSERT INTO wikis (repo_id, title, description, structure, model, status, updated_at)
		   VALUES (?, ?, ?, ?, ?, 'completed', ?) RETURNING id`
		: `INSERT INTO wikis (repo_id, title, description, structure, model, status)
		   VALUES (?, ?, ?, ?, ?, 'completed') RETURNING id`;
	const wikiParams = opts.updatedAt
		? [repoRow.id, `${repo} Wiki`, "A test wiki", structure, model, opts.updatedAt]
		: [repoRow.id, `${repo} Wiki`, "A test wiki", structure, model];
	const wikiRow = d.prepare(wikiInsertSql).get(...wikiParams) as { id: number };

	for (const p of pages) {
		d.prepare(
			`INSERT INTO wiki_pages (wiki_id, page_id, title, parent_id, sort_order, content, diagrams, file_paths, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed')`,
		).run(
			wikiRow.id,
			p.pageId,
			p.title,
			p.parentId,
			p.sortOrder,
			p.content,
			JSON.stringify(p.diagrams ?? []),
			JSON.stringify(p.filePaths ?? []),
		);
	}

	return { wikiId: wikiRow.id, repoId: repoRow.id };
}

function parsePayload(result: { content: { type: string; text: string }[] }): unknown {
	return JSON.parse(result.content[0].text);
}

let db: Database;
let handlers: Handlers;

beforeEach(() => {
	db = setupDb();
	handlers = createHandlers(db as unknown as DbLike);
});

afterEach(() => {
	db.close();
});

// Insert an extra completed wiki row for the given repo_id without creating
// a new repos entry. Used to exercise the historical-generation dedup path.
function insertExtraWiki(
	d: Database,
	repoId: number,
	updatedAt: string,
	title = "Extra Wiki",
): number {
	const structure = JSON.stringify({ sections: [] });
	const row = d
		.prepare(
			`INSERT INTO wikis (repo_id, title, description, structure, model, status, updated_at)
			 VALUES (?, ?, 'older gen', ?, 'claude-sonnet', 'completed', ?) RETURNING id`,
		)
		.get(repoId, title, structure, updatedAt) as { id: number };
	return row.id;
}

describe("list_wikis", () => {
	test("compact mode includes per-section pageCount and pageIds", async () => {
		seedWiki(db);
		const result = await handlers.listWikis({});
		const payload = parsePayload(result) as Array<{
			owner: string;
			repo: string;
			ageDays: number | null;
			totalContentChars: number;
			sections: {
				id: string;
				pageCount: number;
				pageIds: string[];
				totalContentChars: number;
			}[];
		}>;
		expect(payload).toHaveLength(1);
		expect(payload[0].owner).toBe("andyhtran");
		expect(payload[0].sections[0].pageCount).toBe(2);
		expect(payload[0].sections[0].pageIds).toEqual(["overview", "architecture"]);
		expect(payload[0].ageDays).toBeGreaterThanOrEqual(0);
		// Section total = sum of its two page contents; wiki total matches since
		// there's only one section in the fixture.
		const expectedChars = SAMPLE_CONTENT_NO_DIAGRAM.length + SAMPLE_CONTENT_WITH_DIAGRAM.length;
		expect(payload[0].sections[0].totalContentChars).toBe(expectedChars);
		expect(payload[0].totalContentChars).toBe(expectedChars);
	});

	test("verbose mode includes per-page contentChars and section totals", async () => {
		seedWiki(db);
		const result = await handlers.listWikis({ verbose: true });
		const payload = parsePayload(result) as Array<{
			totalContentChars: number;
			sections: {
				totalContentChars: number;
				pages: { id: string; contentChars: number }[];
			}[];
		}>;
		const overview = payload[0].sections[0].pages.find((p) => p.id === "overview");
		expect(overview?.contentChars).toBe(SAMPLE_CONTENT_NO_DIAGRAM.length);
		expect(payload[0].sections[0].totalContentChars).toBe(
			SAMPLE_CONTENT_NO_DIAGRAM.length + SAMPLE_CONTENT_WITH_DIAGRAM.length,
		);
		expect(payload[0].totalContentChars).toBe(payload[0].sections[0].totalContentChars);
	});

	test("default hides older generations and surfaces historicalCount", async () => {
		// Seed the newest generation via the normal helper, then splice in two
		// older rows tied to the same repo_id so we can prove dedup works.
		const { repoId } = seedWiki(db, { updatedAt: "2026-04-15 00:00:00" });
		insertExtraWiki(db, repoId, "2025-12-01 00:00:00", "First gen");
		insertExtraWiki(db, repoId, "2026-01-10 00:00:00", "Second gen");

		const result = await handlers.listWikis({});
		const payload = parsePayload(result) as Array<{
			title: string;
			historicalCount: number;
		}>;
		expect(payload).toHaveLength(1);
		expect(payload[0].title).toBe("deepwiki-by-cc Wiki");
		expect(payload[0].historicalCount).toBe(2);
	});

	test("includeHistorical: true returns every generation without historicalCount", async () => {
		const { repoId } = seedWiki(db, { updatedAt: "2026-04-15 00:00:00" });
		insertExtraWiki(db, repoId, "2025-12-01 00:00:00", "First gen");
		insertExtraWiki(db, repoId, "2026-01-10 00:00:00", "Second gen");

		const result = await handlers.listWikis({ includeHistorical: true });
		const payload = parsePayload(result) as Array<{
			title: string;
			historicalCount?: number;
		}>;
		expect(payload).toHaveLength(3);
		// Newest first (matches ORDER BY updated_at DESC).
		expect(payload[0].title).toBe("deepwiki-by-cc Wiki");
		expect(payload[1].title).toBe("Second gen");
		expect(payload[2].title).toBe("First gen");
		// historicalCount is only meaningful in the deduped view; suppress it when
		// the caller asked for the full history so the field isn't misread.
		expect(payload[0].historicalCount).toBeUndefined();
	});

	test("query miss returns didYouMean error", async () => {
		seedWiki(db, { owner: "aliang-fyi", repo: "NanoVoice" });
		const result = await handlers.listWikis({ query: "NanoVice" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/Did you mean.*NanoVoice/);
	});
});

describe("list_pages", () => {
	test("returns outline with ageDays, contentChars, and section totals", async () => {
		seedWiki(db);
		const result = await handlers.listPages({ owner: "andyhtran", repo: "deepwiki-by-cc" });
		const payload = parsePayload(result) as {
			ageDays: number | null;
			commitSha: string;
			totalContentChars: number;
			sections: {
				totalContentChars: number;
				pages: { id: string; contentChars: number }[];
			}[];
		};
		expect(payload.ageDays).toBeGreaterThanOrEqual(0);
		expect(payload.commitSha).toBe("1357b4f");
		expect(payload.sections[0].pages[0].contentChars).toBeGreaterThan(0);
		const sectionSum = payload.sections[0].pages.reduce((s, p) => s + p.contentChars, 0);
		expect(payload.sections[0].totalContentChars).toBe(sectionSum);
		expect(payload.totalContentChars).toBe(sectionSum);
	});

	test("unknown owner/repo returns didYouMean", async () => {
		seedWiki(db, { owner: "andyhtran", repo: "deepwiki-by-cc" });
		// With only one wiki present, getWikiId falls back to the single wiki
		// regardless of owner/repo. Seed a second one so the miss is real.
		seedWiki(db, { owner: "other", repo: "totally-different-name" });
		const result = await handlers.listPages({ owner: "nope", repo: "missing" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/No wiki found/);
	});
});

describe("get_wiki_pages", () => {
	test("mode=full returns content including mermaid blocks", async () => {
		seedWiki(db);
		const result = await handlers.getWikiPages({
			owner: "andyhtran",
			repo: "deepwiki-by-cc",
			pageIds: ["architecture"],
		});
		const payload = parsePayload(result) as {
			mode: string;
			pages: { content: string }[];
		};
		expect(payload.mode).toBe("full");
		expect(payload.pages[0].content).toContain("```mermaid");
	});

	test("mode=no-diagrams strips mermaid blocks", async () => {
		seedWiki(db);
		const result = await handlers.getWikiPages({
			owner: "andyhtran",
			repo: "deepwiki-by-cc",
			pageIds: ["architecture"],
			mode: "no-diagrams",
		});
		const payload = parsePayload(result) as { pages: { content: string }[] };
		expect(payload.pages[0].content).not.toContain("```mermaid");
		expect(payload.pages[0].content).toContain("Intro paragraph.");
		expect(payload.pages[0].content).toContain("After the diagram.");
	});

	test("mode=summary stops at the first H2", async () => {
		seedWiki(db);
		const result = await handlers.getWikiPages({
			owner: "andyhtran",
			repo: "deepwiki-by-cc",
			pageIds: ["overview"],
			mode: "summary",
		});
		const payload = parsePayload(result) as { pages: { content: string }[] };
		expect(payload.pages[0].content).toContain("This page explains the overview.");
		expect(payload.pages[0].content).not.toContain("Details");
	});

	test("mode=diagrams returns extracted mermaid array", async () => {
		seedWiki(db);
		const result = await handlers.getWikiPages({
			owner: "andyhtran",
			repo: "deepwiki-by-cc",
			pageIds: ["architecture"],
			mode: "diagrams",
		});
		const payload = parsePayload(result) as {
			pages: { diagrams: string[] }[];
		};
		expect(payload.pages[0].diagrams).toHaveLength(1);
		expect(payload.pages[0].diagrams[0]).toContain("graph TD");
	});

	test("mode=citations returns just file paths", async () => {
		seedWiki(db);
		const result = await handlers.getWikiPages({
			owner: "andyhtran",
			repo: "deepwiki-by-cc",
			pageIds: ["architecture"],
			mode: "citations",
		});
		const payload = parsePayload(result) as {
			pages: { filePaths: string[]; content?: string }[];
		};
		expect(payload.pages[0].filePaths).toEqual(["src/mcp/server.ts"]);
		expect(payload.pages[0].content).toBeUndefined();
	});

	test("mode=outline returns an H1/H2/H3 tree, contentChars, and skips code fences", async () => {
		// Seed a single page with headings at each level plus a fenced block
		// containing a pseudo-heading that must not appear in the outline.
		const content =
			"# Top Level\n\nIntro.\n\n## Middle\n\nBody.\n\n```mermaid\n# not a heading\ngraph TD\n  A-->B\n```\n\n### Deep\n\nMore.\n\n#### Too Deep\n\nIgnored.";
		seedWiki(db, {
			pages: [
				{
					pageId: "outlined",
					title: "Outlined",
					parentId: null,
					sortOrder: 0,
					content,
				},
			],
			sections: [{ id: "root", title: "Root", pages: [{ id: "outlined", title: "Outlined" }] }],
		});

		const result = await handlers.getWikiPages({
			owner: "andyhtran",
			repo: "deepwiki-by-cc",
			pageIds: ["outlined"],
			mode: "outline",
		});
		const payload = parsePayload(result) as {
			mode: string;
			pages: {
				outline: { level: number; text: string }[];
				contentChars: number;
				content?: string;
			}[];
		};
		expect(payload.mode).toBe("outline");
		expect(payload.pages[0].content).toBeUndefined();
		expect(payload.pages[0].contentChars).toBe(content.length);
		expect(payload.pages[0].outline).toEqual([
			{ level: 1, text: "Top Level" },
			{ level: 2, text: "Middle" },
			{ level: 3, text: "Deep" },
		]);
	});

	test("maxTotalChars truncates the spill page and skips later pages", async () => {
		// Three pages of 1000 chars each, budget of 1500: first page full,
		// second truncated to 500, third returned as a skipped marker.
		const body = "x".repeat(1000);
		seedWiki(db, {
			pages: [
				{
					pageId: "p1",
					title: "Page 1",
					parentId: "root",
					sortOrder: 0,
					content: body,
					filePaths: ["a.ts"],
				},
				{
					pageId: "p2",
					title: "Page 2",
					parentId: "root",
					sortOrder: 1,
					content: body,
					filePaths: ["b.ts"],
				},
				{
					pageId: "p3",
					title: "Page 3",
					parentId: "root",
					sortOrder: 2,
					content: body,
					filePaths: ["c.ts"],
				},
			],
			sections: [
				{
					id: "root",
					title: "Root",
					pages: [
						{ id: "p1", title: "Page 1" },
						{ id: "p2", title: "Page 2" },
						{ id: "p3", title: "Page 3" },
					],
				},
			],
		});

		const result = await handlers.getWikiPages({
			owner: "andyhtran",
			repo: "deepwiki-by-cc",
			sectionIds: ["root"],
			maxTotalChars: 1500,
		});
		const payload = parsePayload(result) as {
			truncated?: boolean;
			truncatedByTotal?: boolean;
			skippedCount?: number;
			pages: {
				pageId: string;
				content?: string;
				filePaths?: string[];
				truncated?: boolean;
				skipped?: boolean;
				contentChars?: number;
			}[];
		};

		expect(payload.truncated).toBe(true);
		expect(payload.truncatedByTotal).toBe(true);
		expect(payload.skippedCount).toBe(1);

		expect(payload.pages[0].pageId).toBe("p1");
		expect(payload.pages[0].content).toBe(body);
		expect(payload.pages[0].truncated).toBeUndefined();

		expect(payload.pages[1].pageId).toBe("p2");
		expect(payload.pages[1].content).toHaveLength(500);
		expect(payload.pages[1].truncated).toBe(true);

		// Skipped marker: structural metadata kept so the agent can re-request
		// this page with a wider budget, but no content consumed.
		expect(payload.pages[2].pageId).toBe("p3");
		expect(payload.pages[2].skipped).toBe(true);
		expect(payload.pages[2].content).toBeUndefined();
		expect(payload.pages[2].contentChars).toBe(body.length);
		expect(payload.pages[2].filePaths).toEqual(["c.ts"]);
	});

	test("maxTotalChars does not flag truncatedByTotal when budget fits", async () => {
		seedWiki(db);
		const result = await handlers.getWikiPages({
			owner: "andyhtran",
			repo: "deepwiki-by-cc",
			pageIds: ["overview"],
			maxTotalChars: 1_000_000,
		});
		const payload = parsePayload(result) as {
			truncatedByTotal?: boolean;
			skippedCount?: number;
		};
		expect(payload.truncatedByTotal).toBeUndefined();
		expect(payload.skippedCount).toBeUndefined();
	});

	test("maxTotalChars is ignored for non-content-bearing modes like outline", async () => {
		const body = "x".repeat(5000);
		seedWiki(db, {
			pages: [
				{
					pageId: "p1",
					title: "Page 1",
					parentId: "root",
					sortOrder: 0,
					content: `# H\n\n${body}`,
				},
				{
					pageId: "p2",
					title: "Page 2",
					parentId: "root",
					sortOrder: 1,
					content: `# H\n\n${body}`,
				},
			],
			sections: [
				{
					id: "root",
					title: "Root",
					pages: [
						{ id: "p1", title: "Page 1" },
						{ id: "p2", title: "Page 2" },
					],
				},
			],
		});
		const result = await handlers.getWikiPages({
			owner: "andyhtran",
			repo: "deepwiki-by-cc",
			sectionIds: ["root"],
			mode: "outline",
			maxTotalChars: 10, // deliberately tiny
		});
		const payload = parsePayload(result) as {
			truncatedByTotal?: boolean;
			skippedCount?: number;
			pages: { outline: unknown[] }[];
		};
		// Outline metadata is structural, not prose — total-cap must not drop or
		// truncate it, otherwise the "cheap survey" contract breaks.
		expect(payload.truncatedByTotal).toBeUndefined();
		expect(payload.skippedCount).toBeUndefined();
		expect(payload.pages).toHaveLength(2);
		expect(payload.pages[0].outline).toHaveLength(1);
		expect(payload.pages[1].outline).toHaveLength(1);
	});

	test("sectionIds expand to child pages in sort_order", async () => {
		seedWiki(db);
		const result = await handlers.getWikiPages({
			owner: "andyhtran",
			repo: "deepwiki-by-cc",
			sectionIds: ["intro"],
			mode: "citations",
		});
		const payload = parsePayload(result) as { pages: { pageId: string }[] };
		expect(payload.pages.map((p) => p.pageId)).toEqual(["overview", "architecture"]);
	});

	test("pageIds + sectionIds union dedupes and preserves order", async () => {
		seedWiki(db);
		const result = await handlers.getWikiPages({
			owner: "andyhtran",
			repo: "deepwiki-by-cc",
			pageIds: ["architecture"],
			sectionIds: ["intro"],
			mode: "citations",
		});
		const payload = parsePayload(result) as { pages: { pageId: string }[] };
		// architecture appears first (explicit pageIds first), then overview from
		// the section (architecture is deduped on second occurrence).
		expect(payload.pages.map((p) => p.pageId)).toEqual(["architecture", "overview"]);
	});

	test("missing pageIds emit a missing entry with didYouMean", async () => {
		seedWiki(db);
		const result = await handlers.getWikiPages({
			owner: "andyhtran",
			repo: "deepwiki-by-cc",
			pageIds: ["architecure"], // typo
			mode: "citations",
		});
		const payload = parsePayload(result) as {
			pages: { pageId: string; missing?: true; didYouMean?: string[] }[];
		};
		expect(payload.pages[0].missing).toBe(true);
		expect(payload.pages[0].didYouMean).toContain("architecture");
	});

	test("maxCharsPerPage truncates and flags pages", async () => {
		seedWiki(db);
		const result = await handlers.getWikiPages({
			owner: "andyhtran",
			repo: "deepwiki-by-cc",
			pageIds: ["overview"],
			mode: "full",
			maxCharsPerPage: 20,
		});
		const payload = parsePayload(result) as {
			truncated?: boolean;
			pages: { content: string; truncated?: boolean }[];
		};
		expect(payload.pages[0].content.length).toBeLessThanOrEqual(20);
		expect(payload.pages[0].truncated).toBe(true);
		expect(payload.truncated).toBe(true);
	});

	test("warning fires when content exceeds threshold without maxCharsPerPage", async () => {
		// Seed one giant page so total chars exceed the 50_000 warn threshold.
		const big = "x".repeat(60_000);
		seedWiki(db, {
			pages: [
				{
					pageId: "huge",
					title: "Huge",
					parentId: null,
					sortOrder: 0,
					content: big,
				},
			],
			sections: [{ id: "root", title: "Root", pages: [{ id: "huge", title: "Huge" }] }],
		});
		const result = await handlers.getWikiPages({
			owner: "andyhtran",
			repo: "deepwiki-by-cc",
			pageIds: ["huge"],
		});
		const payload = parsePayload(result) as { warning?: string };
		expect(payload.warning).toMatch(/maxCharsPerPage/);
	});

	test("requires at least one of pageIds or sectionIds", async () => {
		seedWiki(db);
		const result = await handlers.getWikiPages({
			owner: "andyhtran",
			repo: "deepwiki-by-cc",
		});
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/pageIds.*sectionIds/);
	});
});

describe("search_wiki", () => {
	test("default mode is semantic (falls back to lexical when no embeddings)", async () => {
		seedWiki(db);
		const result = await handlers.searchWiki({
			owner: "andyhtran",
			repo: "deepwiki-by-cc",
			query: "overview",
		});
		const payload = parsePayload(result) as {
			mode: string;
			note?: string;
			results: { pageId: string }[];
		};
		// No embeddings indexed in the fixture → semantic falls back to lexical
		// and tags the response with a note explaining the fallback.
		expect(payload.mode).toBe("lexical");
		expect(payload.note).toBe("semantic_unavailable_fell_back_to_lexical");
		expect(payload.results.length).toBeGreaterThan(0);
	});

	test("explicit mode=lexical scores by title+content", async () => {
		seedWiki(db);
		const result = await handlers.searchWiki({
			owner: "andyhtran",
			repo: "deepwiki-by-cc",
			query: "architecture",
			mode: "lexical",
		});
		const payload = parsePayload(result) as {
			mode: string;
			results: { pageId: string; score: number }[];
		};
		expect(payload.mode).toBe("lexical");
		expect(payload.results[0].pageId).toBe("architecture");
	});

	test("topK caps result count", async () => {
		seedWiki(db);
		const result = await handlers.searchWiki({
			owner: "andyhtran",
			repo: "deepwiki-by-cc",
			query: "the",
			mode: "lexical",
			topK: 1,
		});
		const payload = parsePayload(result) as { results: unknown[] };
		expect(payload.results).toHaveLength(1);
	});

	test("cross-repo (omit owner+repo) searches all wikis lexically", async () => {
		seedWiki(db, { owner: "andyhtran", repo: "deepwiki-by-cc" });
		seedWiki(db, {
			owner: "aliang-fyi",
			repo: "NanoVoice",
			pages: [
				{
					pageId: "audio",
					title: "Audio Capture",
					parentId: null,
					sortOrder: 0,
					content: "How audio capture works in NanoVoice.",
				},
			],
			sections: [{ id: "root", title: "Root", pages: [{ id: "audio", title: "Audio Capture" }] }],
		});
		const result = await handlers.searchWiki({ query: "audio capture", mode: "lexical" });
		const payload = parsePayload(result) as {
			mode: string;
			crossRepo: boolean;
			results: { wiki: string; pageId: string }[];
		};
		expect(payload.crossRepo).toBe(true);
		expect(payload.results[0].wiki).toBe("aliang-fyi/NanoVoice");
		expect(payload.results[0].pageId).toBe("audio");
	});

	test("cross-repo + mode=semantic returns an action-oriented error", async () => {
		seedWiki(db);
		const result = await handlers.searchWiki({ query: "overview", mode: "semantic" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/Cross-repo semantic search is not supported/);
		expect(result.content[0].text).toMatch(/mode: "lexical"/);
	});

	test("empty query is rejected", async () => {
		const result = await handlers.searchWiki({ query: "   " });
		expect(result.isError).toBe(true);
	});
});

describe("find_pages_mentioning", () => {
	test("matches pages by file path substring with header metadata", async () => {
		seedWiki(db);
		const result = await handlers.findPagesMentioning({
			owner: "andyhtran",
			repo: "deepwiki-by-cc",
			path: "mcp/server",
		});
		const payload = parsePayload(result) as {
			commitSha: string;
			matches: { pageId: string; matchedPaths: string[] }[];
		};
		expect(payload.commitSha).toBe("1357b4f");
		expect(payload.matches[0].pageId).toBe("architecture");
		expect(payload.matches[0].matchedPaths).toContain("src/mcp/server.ts");
	});

	test("no matches returns guidance, not an error", async () => {
		seedWiki(db);
		const result = await handlers.findPagesMentioning({
			owner: "andyhtran",
			repo: "deepwiki-by-cc",
			path: "nonexistent/path",
		});
		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toMatch(/No pages cite/);
	});
});
