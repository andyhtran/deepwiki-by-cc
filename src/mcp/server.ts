// Redirect console.log to stderr — MCP uses stdout for JSON-RPC protocol.
console.log = (...args: unknown[]) => console.error(...args);

import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import Database from "better-sqlite3";
import { z } from "zod";
import { didYouMean } from "./fuzzy.js";

// Resolve DB path: env override, or relative to this script (works from any cwd).
const scriptDir =
	typeof import.meta.dirname === "string"
		? import.meta.dirname
		: join(fileURLToPath(import.meta.url), "..");
const projectRoot = join(scriptDir, "../..");
const dbPath = process.env.DB_PATH || join(projectRoot, "data", "deepwiki.db");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Structural DB type so the handler factory accepts either better-sqlite3
// (production) or bun:sqlite (tests) without coupling tests to a native module.
export interface DbLike {
	prepare(sql: string): {
		get(...params: unknown[]): unknown;
		all(...params: unknown[]): unknown[];
		run(...params: unknown[]): unknown;
	};
}

export interface WikiRow {
	id: number;
	repo_id: number;
	title: string;
	description: string | null;
	structure: string;
	status: string;
	owner: string | null;
	repo_name: string | null;
	page_count: number;
	updated_at: string | null;
	model: string | null;
	last_commit_sha: string | null;
}

export interface PageRow {
	page_id: string;
	title: string;
	content: string | null;
	file_paths: string | null;
}

interface ChunkRow {
	chunk_id: number;
	file_path: string;
	chunk_seq: number;
	chunk_text: string;
	offset_start: number;
	offset_end: number;
	embedding: string;
}

type ToolText = { type: "text"; text: string };
type ToolResult = { content: ToolText[]; isError?: boolean };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getWikiId(db: DbLike, owner: string, repo: string): number | null {
	// Try exact match first, then fall back to repo-name-only match.
	// Agents often guess the wrong owner (e.g. "andyhtran" instead of "local").
	const row = db
		.prepare(
			`SELECT w.id FROM wikis w
			 JOIN repos r ON r.id = w.repo_id
			 WHERE r.owner = ? AND r.name = ? AND w.status = 'completed'
			 ORDER BY w.updated_at DESC LIMIT 1`,
		)
		.get(owner, repo) as { id: number } | undefined;
	if (row) return row.id;

	const fuzzy = db
		.prepare(
			`SELECT w.id FROM wikis w
			 JOIN repos r ON r.id = w.repo_id
			 WHERE LOWER(r.name) = LOWER(?) AND w.status = 'completed'
			 ORDER BY w.updated_at DESC LIMIT 1`,
		)
		.get(repo) as { id: number } | undefined;
	if (fuzzy) return fuzzy.id;

	// If exactly one completed wiki exists, return it regardless of owner/repo.
	// Handles the common single-wiki deployment where agents guess wrong identifiers.
	const allWikis = db.prepare("SELECT w.id FROM wikis w WHERE w.status = 'completed'").all() as {
		id: number;
	}[];
	if (allWikis.length === 1) return allWikis[0].id;

	return null;
}

function getAvailableWikis(db: DbLike): string[] {
	const rows = db
		.prepare(
			`SELECT DISTINCT r.owner, r.name FROM wikis w
			 JOIN repos r ON r.id = w.repo_id
			 WHERE w.status = 'completed' ORDER BY r.owner, r.name`,
		)
		.all() as { owner: string; name: string }[];
	return rows.map((r) => `${r.owner}/${r.name}`);
}

// Suggest likely matches for a miss on owner/repo. We match against both the
// bare repo name and the full "owner/repo" string, because owner prefixes
// inflate Levenshtein distance enough to hide obvious typos in the repo name.
function suggestWikis(query: string, available: string[], limit = 3): string[] {
	const tokenToDisplay = new Map<string, string>();
	for (const display of available) {
		tokenToDisplay.set(display, display);
		const slash = display.indexOf("/");
		if (slash >= 0) {
			const repo = display.slice(slash + 1);
			if (repo.length > 0 && !tokenToDisplay.has(repo)) tokenToDisplay.set(repo, display);
		}
	}
	const matched = didYouMean(query, Array.from(tokenToDisplay.keys()), limit * 2);
	return Array.from(new Set(matched.map((t) => tokenToDisplay.get(t) ?? t))).slice(0, limit);
}

function unknownWikiError(db: DbLike, owner: string, repo: string): ToolResult {
	const available = getAvailableWikis(db);
	const suggestions = suggestWikis(`${owner}/${repo}`, available);
	const suffix = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}` : "";
	return {
		content: [
			{
				type: "text" as const,
				text: `No wiki found for ${owner}/${repo}. Call list_wikis first to see what's indexed.${suffix}`,
			},
		],
		isError: true,
	};
}

// Days since a SQLite "datetime('now')" timestamp. Floored, never negative.
function ageDays(updatedAt: string | null): number | null {
	if (!updatedAt) return null;
	// SQLite's `datetime('now')` returns "YYYY-MM-DD HH:MM:SS" in UTC.
	// `Date.parse` accepts ISO-like strings; replace the space with 'T' and
	// append 'Z' so the parser treats it as UTC instead of local time.
	const iso = updatedAt.includes("T") ? updatedAt : updatedAt.replace(" ", "T");
	const ts = Date.parse(iso.endsWith("Z") ? iso : `${iso}Z`);
	if (!Number.isFinite(ts)) return null;
	const days = Math.floor((Date.now() - ts) / 86400000);
	return Math.max(0, days);
}

// Strip ```mermaid ... ``` blocks. Keep surrounding markdown intact, including
// any trailing newline so the surrounding paragraphs stay properly separated.
function stripMermaid(content: string): string {
	return content.replace(/```mermaid[\s\S]*?```\n?/g, "");
}

// Summary: prefer a natural cut at the first H2; fall back to the first 300 words.
function summarizeContent(content: string): string {
	const h2 = content.indexOf("\n## ");
	if (h2 > 0) return content.slice(0, h2).trim();
	return content.split(/\s+/).slice(0, 300).join(" ");
}

function countOccurrences(text: string, word: string): number {
	let count = 0;
	let pos = 0;
	while ((pos = text.indexOf(word, pos)) !== -1) {
		count++;
		pos += word.length;
	}
	return count;
}

function scoreMatch(words: string[], title: string, content: string | null): number {
	const titleLower = title.toLowerCase();
	const contentLower = (content || "").toLowerCase();
	let score = 0;
	for (const word of words) {
		score += countOccurrences(titleLower, word) * 3;
		score += countOccurrences(contentLower, word);
	}
	return score;
}

// Lexical scorer shared by single- and cross-repo lexical search.
function lexicalSearch(
	pages: { page_id: string; title: string; content: string | null }[],
	query: string,
	topK: number,
): {
	pageId: string;
	title: string;
	score: number;
	snippet: string;
}[] {
	const words = query
		.toLowerCase()
		.split(/\s+/)
		.filter((w) => w.length > 0);

	return pages
		.map((p) => {
			const title = p.title.toLowerCase();
			const content = p.content?.toLowerCase() || "";
			const hasMatch = words.some((w) => title.includes(w) || content.includes(w));
			if (!hasMatch) return null;

			const score = scoreMatch(words, p.title, p.content);

			let snippet = "";
			if (p.content) {
				const contentLower = p.content.toLowerCase();
				let bestIdx = -1;
				let bestWord = words[0];
				for (const w of words) {
					const idx = contentLower.indexOf(w);
					if (idx >= 0 && (bestIdx < 0 || idx < bestIdx)) {
						bestIdx = idx;
						bestWord = w;
					}
				}
				if (bestIdx >= 0) {
					const start = Math.max(0, bestIdx - 200);
					const end = Math.min(p.content.length, bestIdx + bestWord.length + 200);
					snippet =
						(start > 0 ? "..." : "") +
						p.content.slice(start, end).trim() +
						(end < p.content.length ? "..." : "");
				} else {
					snippet = `${p.content.slice(0, 300).trim()}...`;
				}
			}

			return { pageId: p.page_id, title: p.title, score, snippet };
		})
		.filter((r): r is NonNullable<typeof r> => r !== null)
		.sort((a, b) => b.score - a.score)
		.slice(0, topK);
}

// Cosine similarity for embedding vectors.
function cosine(a: number[], b: number[]): number {
	if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	if (normA === 0 || normB === 0) return 0;
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Mirrors createEndpointFingerprint from embeddings/client.ts — duplicated here
// because the MCP server runs as a standalone process without access to the main
// app's module graph.
function computeEndpointFingerprint(baseUrl: string): string {
	let canonical = baseUrl.trim().replace(/\/+$/, "");
	if (canonical.endsWith("/v1/embeddings")) {
		canonical = canonical.slice(0, -"/v1/embeddings".length);
	} else if (canonical.endsWith("/v1")) {
		canonical = canonical.slice(0, -"/v1".length);
	}
	return createHash("sha256").update(canonical).digest("hex");
}

function getRepoIdForWiki(db: DbLike, wikiId: number): number | null {
	const row = db.prepare("SELECT repo_id FROM wikis WHERE id = ?").get(wikiId) as
		| { repo_id: number }
		| undefined;
	return row?.repo_id ?? null;
}

function getEmbeddingSetting(db: DbLike, key: string): string | null {
	const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
		| { value: string }
		| undefined;
	return row?.value ?? null;
}

interface WikiHeader {
	owner: string;
	repo: string;
	commitSha: string | null;
	generatedAt: string | null;
	ageDays: number | null;
}

function loadWikiHeader(db: DbLike, wikiId: number): WikiHeader | null {
	const row = db
		.prepare(
			`SELECT w.updated_at, r.owner, r.name AS repo_name, r.last_commit_sha
			 FROM wikis w LEFT JOIN repos r ON r.id = w.repo_id
			 WHERE w.id = ?`,
		)
		.get(wikiId) as
		| {
				updated_at: string | null;
				owner: string | null;
				repo_name: string | null;
				last_commit_sha: string | null;
		  }
		| undefined;
	if (!row) return null;
	return {
		owner: row.owner ?? "",
		repo: row.repo_name ?? "",
		commitSha: row.last_commit_sha ? row.last_commit_sha.slice(0, 7) : null,
		generatedAt: row.updated_at,
		ageDays: ageDays(row.updated_at),
	};
}

// ---------------------------------------------------------------------------
// Handlers — exported as a factory so tests can pass any DbLike (e.g. bun:sqlite).
// ---------------------------------------------------------------------------

export interface Handlers {
	listWikis: (args: {
		query?: string;
		verbose?: boolean;
		includeHistorical?: boolean;
	}) => Promise<ToolResult>;
	listPages: (args: { owner: string; repo: string }) => Promise<ToolResult>;
	getWikiPages: (args: {
		owner: string;
		repo: string;
		pageIds?: string[];
		sectionIds?: string[];
		mode?: "full" | "no-diagrams" | "summary" | "diagrams" | "citations" | "outline";
		maxCharsPerPage?: number;
		maxTotalChars?: number;
	}) => Promise<ToolResult>;
	searchWiki: (args: {
		query: string;
		owner?: string;
		repo?: string;
		mode?: "semantic" | "lexical";
		topK?: number;
	}) => Promise<ToolResult>;
	findPagesMentioning: (args: { owner: string; repo: string; path: string }) => Promise<ToolResult>;
}

// Soft cap. Above this, get_wiki_pages emits a `warning` field nudging the
// caller to set maxCharsPerPage. Not a hard error — agents may legitimately
// want the full payload.
const TOTAL_CHAR_WARN_THRESHOLD = 50_000;

export function createHandlers(db: DbLike): Handlers {
	return {
		// ------------------------------------------------------------------
		async listWikis({ query, verbose, includeHistorical }) {
			// Default: one row per repo (the most recent completed generation).
			// Ties on updated_at are broken by higher id (= more recently inserted),
			// which matches how the pipeline writes regenerations.
			const selectCols = `w.id, w.repo_id, w.title, w.description, w.structure, w.status, w.updated_at, w.model,
					r.owner, r.name as repo_name, r.last_commit_sha,
					(SELECT COUNT(*) FROM wiki_pages wp WHERE wp.wiki_id = w.id) as page_count`;
			const wikis = includeHistorical
				? (db
						.prepare(
							`SELECT ${selectCols}
							 FROM wikis w LEFT JOIN repos r ON r.id = w.repo_id
							 WHERE w.status = 'completed'
							 ORDER BY w.updated_at DESC`,
						)
						.all() as WikiRow[])
				: (db
						.prepare(
							`SELECT ${selectCols}
							 FROM wikis w LEFT JOIN repos r ON r.id = w.repo_id
							 WHERE w.status = 'completed'
							   AND w.id = (
								 SELECT w2.id FROM wikis w2
								 WHERE w2.repo_id = w.repo_id AND w2.status = 'completed'
								 ORDER BY w2.updated_at DESC, w2.id DESC LIMIT 1
							   )
							 ORDER BY w.updated_at DESC`,
						)
						.all() as WikiRow[]);

			const q = query?.trim().toLowerCase() ?? "";
			const filtered = q
				? wikis.filter(
						(w) =>
							(w.owner ?? "").toLowerCase().includes(q) ||
							(w.repo_name ?? "").toLowerCase().includes(q) ||
							(w.title ?? "").toLowerCase().includes(q),
					)
				: wikis;

			if (q && filtered.length === 0) {
				const available = wikis.flatMap((w) =>
					w.owner && w.repo_name ? [`${w.owner}/${w.repo_name}`] : [],
				);
				const suggestions = suggestWikis(q, available);
				const suffix = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}` : "";
				return {
					content: [
						{
							type: "text" as const,
							text: `No wikis match "${query}".${suffix}`,
						},
					],
					isError: true,
				};
			}

			// Load per-page char counts once. Used for wiki/section totals in every
			// mode, plus per-page contentChars in verbose.
			const charsByWikiPage = loadContentChars(
				db,
				filtered.map((w) => w.id),
			);

			// How many older completed generations exist per repo? Only meaningful
			// in the default (dedup) view — when includeHistorical is true the
			// caller is already seeing every row.
			const historicalByRepo = includeHistorical
				? null
				: loadHistoricalCounts(
						db,
						filtered.map((w) => w.repo_id),
					);

			const result = filtered.map((w) => {
				const full = JSON.parse(w.structure) as {
					sections: {
						id: string;
						title: string;
						description?: string;
						pages: { id: string; title: string; description?: string }[];
					}[];
				};
				const charsForWiki = charsByWikiPage.get(w.id) ?? new Map<string, number>();
				const totalContentChars = Array.from(charsForWiki.values()).reduce(
					(sum, c) => sum + c,
					0,
				);
				const meta = {
					generatedAt: w.updated_at,
					model: w.model,
					commitSha: w.last_commit_sha ? w.last_commit_sha.slice(0, 7) : null,
					ageDays: ageDays(w.updated_at),
				};
				const historicalCount = historicalByRepo?.get(w.repo_id) ?? 0;
				const historicalField = includeHistorical ? {} : { historicalCount };

				if (verbose) {
					const sections = full.sections.map((s) => ({
						id: s.id,
						title: s.title,
						description: s.description || "",
						totalContentChars: s.pages.reduce(
							(sum, p) => sum + (charsForWiki.get(p.id) ?? 0),
							0,
						),
						pages: s.pages.map((p) => ({
							id: p.id,
							title: p.title,
							description: p.description || "",
							contentChars: charsForWiki.get(p.id) ?? 0,
						})),
					}));
					return {
						owner: w.owner,
						repo: w.repo_name,
						title: w.title,
						description: w.description,
						pageCount: w.page_count,
						totalContentChars,
						...historicalField,
						...meta,
						sections,
					};
				}
				// Compact mode: drop descriptions, expose per-section pageCount + pageIds.
				const sections = full.sections.map((s) => ({
					id: s.id,
					title: s.title,
					pageCount: s.pages.length,
					pageIds: s.pages.map((p) => p.id),
					totalContentChars: s.pages.reduce(
						(sum, p) => sum + (charsForWiki.get(p.id) ?? 0),
						0,
					),
				}));
				return {
					owner: w.owner,
					repo: w.repo_name,
					title: w.title,
					pageCount: w.page_count,
					totalContentChars,
					...historicalField,
					...meta,
					sections,
				};
			});

			return {
				content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
			};
		},

		// ------------------------------------------------------------------
		async listPages({ owner, repo }) {
			const wikiId = getWikiId(db, owner, repo);
			if (!wikiId) return unknownWikiError(db, owner, repo);

			const wiki = db
				.prepare(
					`SELECT w.title, w.structure, w.updated_at, w.model, r.owner, r.name as repo_name, r.last_commit_sha
					 FROM wikis w LEFT JOIN repos r ON r.id = w.repo_id
					 WHERE w.id = ?`,
				)
				.get(wikiId) as
				| {
						title: string;
						structure: string;
						updated_at: string | null;
						model: string | null;
						owner: string;
						repo_name: string;
						last_commit_sha: string | null;
				  }
				| undefined;
			if (!wiki) {
				return {
					content: [{ type: "text" as const, text: `Wiki ${wikiId} is missing its record.` }],
					isError: true,
				};
			}

			const full = JSON.parse(wiki.structure) as {
				sections: {
					id: string;
					title: string;
					description?: string;
					pages: { id: string; title: string; description?: string }[];
				}[];
			};
			const charsForWiki = loadContentChars(db, [wikiId]).get(wikiId) ?? new Map<string, number>();
			const sections = full.sections.map((s) => ({
				id: s.id,
				title: s.title,
				description: s.description || "",
				totalContentChars: s.pages.reduce((sum, p) => sum + (charsForWiki.get(p.id) ?? 0), 0),
				pages: s.pages.map((p) => ({
					id: p.id,
					title: p.title,
					description: p.description || "",
					contentChars: charsForWiki.get(p.id) ?? 0,
				})),
			}));
			const totalContentChars = sections.reduce((sum, s) => sum + s.totalContentChars, 0);

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								owner: wiki.owner,
								repo: wiki.repo_name,
								title: wiki.title,
								generatedAt: wiki.updated_at,
								ageDays: ageDays(wiki.updated_at),
								model: wiki.model,
								commitSha: wiki.last_commit_sha ? wiki.last_commit_sha.slice(0, 7) : null,
								totalContentChars,
								sections,
							},
							null,
							2,
						),
					},
				],
			};
		},

		// ------------------------------------------------------------------
		async getWikiPages({
			owner,
			repo,
			pageIds,
			sectionIds,
			mode,
			maxCharsPerPage,
			maxTotalChars,
		}) {
			const selectedMode = mode ?? "full";
			const wikiId = getWikiId(db, owner, repo);
			if (!wikiId) return unknownWikiError(db, owner, repo);

			const requestedPageIds = pageIds ?? [];
			const requestedSectionIds = sectionIds ?? [];
			if (requestedPageIds.length === 0 && requestedSectionIds.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Provide pageIds, sectionIds, or both. Use list_wikis to find them.",
						},
					],
					isError: true,
				};
			}

			// Resolve sections → ordered page IDs (sort_order), then union with explicit
			// pageIds preserving the request order. Dedup keeps the first occurrence.
			const sectionPageIds = resolveSectionPages(db, wikiId, requestedSectionIds);
			const orderedIds: string[] = [];
			const seen = new Set<string>();
			for (const id of [...requestedPageIds, ...sectionPageIds]) {
				if (!seen.has(id)) {
					seen.add(id);
					orderedIds.push(id);
				}
			}

			if (orderedIds.length > 50) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Resolved ${orderedIds.length} pages, exceeds cap of 50. Narrow your request or paginate.`,
						},
					],
					isError: true,
				};
			}

			const placeholders = orderedIds.map(() => "?").join(",");
			const rows = db
				.prepare(
					`SELECT page_id, title, content, file_paths, diagrams FROM wiki_pages
					 WHERE wiki_id = ? AND page_id IN (${placeholders})`,
				)
				.all(wikiId, ...orderedIds) as (PageRow & { diagrams: string | null })[];
			const byId = new Map(rows.map((r) => [r.page_id, r]));

			const allIds = (
				db.prepare("SELECT page_id FROM wiki_pages WHERE wiki_id = ?").all(wikiId) as {
					page_id: string;
				}[]
			).map((r) => r.page_id);

			// Only content-bearing modes consume the maxTotalChars budget. Outline,
			// diagrams, and citations are small and structured, so skipping/truncating
			// them would remove metadata the caller explicitly asked for.
			const consumesBudget =
				selectedMode === "full" || selectedMode === "no-diagrams" || selectedMode === "summary";
			const totalCapActive = consumesBudget && maxTotalChars !== undefined;

			let totalChars = 0;
			const truncatedAny = { value: false };
			let totalCapHit = false;
			let skippedCount = 0;

			const pages: Record<string, unknown>[] = [];
			for (const id of orderedIds) {
				const row = byId.get(id);
				if (!row) {
					pages.push({
						pageId: id,
						missing: true as const,
						didYouMean: didYouMean(id, allIds),
					});
					continue;
				}

				// When the total cap is active, narrow the per-page cap to whatever
				// budget remains. This keeps renderPage's single truncation path in
				// charge of cutting content, so we don't double-slice.
				let effectiveCap = maxCharsPerPage;
				if (totalCapActive) {
					const remaining = (maxTotalChars as number) - totalChars;
					const rawLen = (row.content ?? "").length;
					if (remaining <= 0) {
						// Budget exhausted — emit a skipped marker so the caller knows
						// this page exists and how big it is, without eating any context.
						const filePaths = JSON.parse(row.file_paths || "[]") as string[];
						pages.push({
							pageId: row.page_id,
							title: row.title,
							filePaths,
							skipped: true as const,
							contentChars: rawLen,
						});
						skippedCount++;
						totalCapHit = true;
						continue;
					}
					const priorCap = maxCharsPerPage ?? Number.POSITIVE_INFINITY;
					if (rawLen > remaining && remaining < priorCap) {
						// Total cap is tighter than per-page cap for this page — total
						// cap will be the binding constraint during truncation.
						totalCapHit = true;
					}
					effectiveCap = Math.min(priorCap, remaining);
					if (!Number.isFinite(effectiveCap)) effectiveCap = undefined;
				}

				pages.push(
					renderPage(
						row,
						selectedMode,
						effectiveCap,
						(chars) => {
							totalChars += chars;
						},
						truncatedAny,
					),
				);
			}

			const header = loadWikiHeader(db, wikiId);
			const envelope: Record<string, unknown> = {
				owner: header?.owner ?? owner,
				repo: header?.repo ?? repo,
				commitSha: header?.commitSha ?? null,
				generatedAt: header?.generatedAt ?? null,
				ageDays: header?.ageDays ?? null,
				mode: selectedMode,
				pages,
			};

			// Soft warning when the response is large and neither cap was set. Lets
			// the agent re-issue the call with a cap rather than burning context on
			// a partial-read failure mode.
			if (
				(selectedMode === "full" || selectedMode === "no-diagrams") &&
				maxCharsPerPage === undefined &&
				maxTotalChars === undefined &&
				totalChars > TOTAL_CHAR_WARN_THRESHOLD
			) {
				envelope.warning = `Response is ${totalChars.toLocaleString()} chars. Consider re-calling with maxCharsPerPage or maxTotalChars to trim.`;
			}
			if (truncatedAny.value) envelope.truncated = true;
			if (totalCapHit) envelope.truncatedByTotal = true;
			if (skippedCount > 0) envelope.skippedCount = skippedCount;

			return {
				content: [{ type: "text" as const, text: JSON.stringify(envelope, null, 2) }],
			};
		},

		// ------------------------------------------------------------------
		async searchWiki({ query, owner, repo, mode, topK }) {
			const trimmedQuery = query.trim();
			if (trimmedQuery.length === 0) {
				return {
					content: [{ type: "text" as const, text: "Search query cannot be empty." }],
					isError: true,
				};
			}
			const selectedMode = mode ?? "semantic";
			const limit = topK ?? 10;
			const crossRepo = !owner && !repo;

			if (crossRepo && selectedMode === "semantic") {
				return {
					content: [
						{
							type: "text" as const,
							text: 'Cross-repo semantic search is not supported (each repo may use a different embedding model and endpoint, so cosine scores are not comparable). Use mode: "lexical" for cross-repo, or specify owner+repo for semantic.',
						},
					],
					isError: true,
				};
			}

			if (crossRepo) {
				return crossRepoLexicalSearch(db, trimmedQuery, limit);
			}

			// Resolve owner/repo (allow getWikiId's fuzzy fallbacks).
			if (!owner || !repo) {
				return {
					content: [
						{
							type: "text" as const,
							text: "owner and repo are required unless you omit both for cross-repo lexical search.",
						},
					],
					isError: true,
				};
			}
			const wikiId = getWikiId(db, owner, repo);
			if (!wikiId) return unknownWikiError(db, owner, repo);

			if (selectedMode === "lexical") {
				return singleRepoLexicalSearch(db, wikiId, trimmedQuery, limit);
			}

			return semanticSearch(db, wikiId, trimmedQuery, limit);
		},

		// ------------------------------------------------------------------
		async findPagesMentioning({ owner, repo, path }) {
			const wikiId = getWikiId(db, owner, repo);
			if (!wikiId) return unknownWikiError(db, owner, repo);

			const rows = db
				.prepare("SELECT page_id, title, file_paths FROM wiki_pages WHERE wiki_id = ?")
				.all(wikiId) as { page_id: string; title: string; file_paths: string | null }[];
			const needle = path.toLowerCase();
			const matches = rows
				.map((r) => {
					const paths = JSON.parse(r.file_paths ?? "[]") as string[];
					const matched = paths.filter((p) => p.toLowerCase().includes(needle));
					if (matched.length === 0) return null;
					return { pageId: r.page_id, title: r.title, matchedPaths: matched };
				})
				.filter((r): r is NonNullable<typeof r> => r !== null)
				.sort((a, b) => b.matchedPaths.length - a.matchedPaths.length);

			const header = loadWikiHeader(db, wikiId);
			if (matches.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No pages cite any path matching "${path}". Try a shorter fragment, or use search_wiki for content matches.`,
						},
					],
				};
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								owner: header?.owner ?? owner,
								repo: header?.repo ?? repo,
								commitSha: header?.commitSha ?? null,
								generatedAt: header?.generatedAt ?? null,
								ageDays: header?.ageDays ?? null,
								matches,
							},
							null,
							2,
						),
					},
				],
			};
		},
	};
}

// ---------------------------------------------------------------------------
// Internal helpers used by handlers
// ---------------------------------------------------------------------------

// Count completed wikis per repo so we can surface historicalCount on each
// row in the default (deduped) list_wikis view. A value of 0 means the
// visible row is the only generation for its repo.
function loadHistoricalCounts(db: DbLike, repoIds: number[]): Map<number, number> {
	const out = new Map<number, number>();
	if (repoIds.length === 0) return out;
	// Deduplicate to avoid inflating COUNT when the caller passes the same
	// repo_id twice (shouldn't happen post-dedup, but cheap insurance).
	const unique = Array.from(new Set(repoIds));
	const placeholders = unique.map(() => "?").join(",");
	const rows = db
		.prepare(
			`SELECT repo_id, COUNT(*) AS total FROM wikis
			 WHERE status = 'completed' AND repo_id IN (${placeholders})
			 GROUP BY repo_id`,
		)
		.all(...unique) as { repo_id: number; total: number }[];
	for (const r of rows) out.set(r.repo_id, Math.max(0, r.total - 1));
	return out;
}

// Extract an H1/H2/H3 heading tree from markdown. Lines inside fenced code
// blocks (```...```) are ignored so diagrams and code samples don't leak
// false headings. Trailing ATX closers ("# Title #") are stripped.
function extractOutline(content: string): { level: number; text: string }[] {
	const out: { level: number; text: string }[] = [];
	let inFence = false;
	for (const line of content.split(/\r?\n/)) {
		if (line.trim().startsWith("```")) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const m = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
		if (m) out.push({ level: m[1].length, text: m[2].trim() });
	}
	return out;
}

function loadContentChars(db: DbLike, wikiIds: number[]): Map<number, Map<string, number>> {
	const out = new Map<number, Map<string, number>>();
	if (wikiIds.length === 0) return out;
	const placeholders = wikiIds.map(() => "?").join(",");
	const rows = db
		.prepare(
			`SELECT wiki_id, page_id, LENGTH(content) AS content_chars
			 FROM wiki_pages WHERE wiki_id IN (${placeholders})`,
		)
		.all(...wikiIds) as { wiki_id: number; page_id: string; content_chars: number | null }[];
	for (const r of rows) {
		const inner = out.get(r.wiki_id) ?? new Map<string, number>();
		inner.set(r.page_id, r.content_chars ?? 0);
		out.set(r.wiki_id, inner);
	}
	return out;
}

function resolveSectionPages(db: DbLike, wikiId: number, sectionIds: string[]): string[] {
	if (sectionIds.length === 0) return [];
	const placeholders = sectionIds.map(() => "?").join(",");
	const rows = db
		.prepare(
			`SELECT page_id, parent_id FROM wiki_pages
			 WHERE wiki_id = ? AND parent_id IN (${placeholders})
			 ORDER BY parent_id, sort_order`,
		)
		.all(wikiId, ...sectionIds) as { page_id: string; parent_id: string }[];
	// Group by section, then iterate sections in the order requested.
	const bySection = new Map<string, string[]>();
	for (const r of rows) {
		const arr = bySection.get(r.parent_id) ?? [];
		arr.push(r.page_id);
		bySection.set(r.parent_id, arr);
	}
	const out: string[] = [];
	for (const sid of sectionIds) {
		for (const id of bySection.get(sid) ?? []) out.push(id);
	}
	return out;
}

function renderPage(
	page: PageRow & { diagrams: string | null },
	mode: "full" | "no-diagrams" | "summary" | "diagrams" | "citations" | "outline",
	maxCharsPerPage: number | undefined,
	addToTotal: (chars: number) => void,
	truncatedAny: { value: boolean },
): Record<string, unknown> {
	const filePaths = JSON.parse(page.file_paths || "[]") as string[];
	const base = { pageId: page.page_id, title: page.title, filePaths };

	if (mode === "citations") {
		return base;
	}

	if (mode === "diagrams") {
		const diagrams = JSON.parse(page.diagrams ?? "[]") as string[];
		return { ...base, diagrams };
	}

	if (mode === "outline") {
		// Outline output is tiny by construction (just headings), so we skip
		// maxCharsPerPage and totalChars accounting for it. contentChars is the
		// full-page size so the caller can decide whether to re-fetch with mode:
		// "full" without a separate list_pages round-trip.
		const raw = page.content ?? "";
		return { ...base, contentChars: raw.length, outline: extractOutline(raw) };
	}

	const raw = page.content ?? "";
	let body: string;
	if (mode === "summary") body = summarizeContent(raw);
	else if (mode === "no-diagrams") body = stripMermaid(raw);
	else body = raw;

	let truncated = false;
	if (maxCharsPerPage !== undefined && body.length > maxCharsPerPage) {
		body = body.slice(0, maxCharsPerPage);
		truncated = true;
		truncatedAny.value = true;
	}
	addToTotal(body.length);

	const out: Record<string, unknown> = { ...base, content: body };
	if (truncated) out.truncated = true;
	return out;
}

function singleRepoLexicalSearch(
	db: DbLike,
	wikiId: number,
	query: string,
	topK: number,
): ToolResult {
	const pages = db
		.prepare("SELECT page_id, title, content FROM wiki_pages WHERE wiki_id = ?")
		.all(wikiId) as PageRow[];
	const results = lexicalSearch(pages, query, topK);
	const header = loadWikiHeader(db, wikiId);
	if (results.length === 0) {
		return {
			content: [
				{
					type: "text" as const,
					text: `No pages matched "${query}". Use list_pages to browse, or try fewer / shorter words.`,
				},
			],
		};
	}
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify(
					{
						owner: header?.owner ?? null,
						repo: header?.repo ?? null,
						commitSha: header?.commitSha ?? null,
						generatedAt: header?.generatedAt ?? null,
						ageDays: header?.ageDays ?? null,
						mode: "lexical",
						results,
					},
					null,
					2,
				),
			},
		],
	};
}

function crossRepoLexicalSearch(db: DbLike, query: string, topK: number): ToolResult {
	// Only search the latest generation per repo. Searching every historical
	// wiki would surface the same content multiple times with stale data.
	const wikis = db
		.prepare(
			`SELECT w.id, r.owner, r.name as repo_name
			 FROM wikis w LEFT JOIN repos r ON r.id = w.repo_id
			 WHERE w.status = 'completed'
			   AND w.id = (
				 SELECT w2.id FROM wikis w2
				 WHERE w2.repo_id = w.repo_id AND w2.status = 'completed'
				 ORDER BY w2.updated_at DESC, w2.id DESC LIMIT 1
			   )`,
		)
		.all() as { id: number; owner: string | null; repo_name: string | null }[];

	const aggregated: {
		wiki: string;
		pageId: string;
		title: string;
		score: number;
		snippet: string;
	}[] = [];
	for (const w of wikis) {
		const pages = db
			.prepare("SELECT page_id, title, content FROM wiki_pages WHERE wiki_id = ?")
			.all(w.id) as PageRow[];
		// Pull a few extra per repo so the global topK isn't starved by one big repo.
		const perRepo = lexicalSearch(pages, query, topK);
		for (const r of perRepo) {
			aggregated.push({
				wiki: `${w.owner ?? ""}/${w.repo_name ?? ""}`,
				...r,
			});
		}
	}
	aggregated.sort((a, b) => b.score - a.score);
	const top = aggregated.slice(0, topK);
	if (top.length === 0) {
		return {
			content: [
				{
					type: "text" as const,
					text: `No pages matched "${query}" across any indexed wiki.`,
				},
			],
		};
	}
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({ mode: "lexical", crossRepo: true, results: top }, null, 2),
			},
		],
	};
}

function semanticSearch(
	db: DbLike,
	wikiId: number,
	query: string,
	topK: number,
): Promise<ToolResult> {
	return semanticSearchAsync(db, wikiId, query, topK);
}

async function semanticSearchAsync(
	db: DbLike,
	wikiId: number,
	query: string,
	topK: number,
): Promise<ToolResult> {
	const repoId = getRepoIdForWiki(db, wikiId);
	if (!repoId) {
		return {
			content: [{ type: "text" as const, text: "Could not resolve repo for this wiki." }],
			isError: true,
		};
	}

	const embModel = getEmbeddingSetting(db, "embeddingsModel") || "text-embedding-3-small";
	const embBaseUrl =
		getEmbeddingSetting(db, "embeddingsBaseUrl") || "https://api.openai.com/v1/embeddings";
	const embApiKey = getEmbeddingSetting(db, "embeddingsApiKey") || "";
	const embFingerprint = computeEndpointFingerprint(embBaseUrl);

	const chunkRows = db
		.prepare(
			`SELECT c.id AS chunk_id, c.file_path, c.chunk_seq, c.chunk_text,
			        c.offset_start, c.offset_end, e.embedding
			 FROM document_chunks c
			 INNER JOIN chunk_embeddings e ON e.chunk_id = c.id
			 WHERE c.repo_id = ?
			   AND e.embedding_model = ?
			   AND e.endpoint_fingerprint = ?
			 ORDER BY c.file_path, c.chunk_seq`,
		)
		.all(repoId, embModel, embFingerprint) as ChunkRow[];

	if (chunkRows.length === 0) {
		// No embeddings indexed — fall back to lexical so the call still returns
		// useful results rather than a confusing empty response.
		return fallbackSemanticToLexical(db, wikiId, query, topK);
	}

	let queryVec: number[];
	try {
		const endpoint = embBaseUrl.trim().replace(/\/+$/, "");
		const url = endpoint.endsWith("/embeddings")
			? endpoint
			: endpoint.endsWith("/v1")
				? `${endpoint}/embeddings`
				: `${endpoint}/v1/embeddings`;

		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (embApiKey.trim().length > 0) headers.Authorization = `Bearer ${embApiKey}`;

		const resp = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify({ model: embModel, input: [query] }),
			signal: AbortSignal.timeout(15_000),
		});
		if (!resp.ok) return fallbackSemanticToLexical(db, wikiId, query, topK);
		const body = (await resp.json()) as { data?: { embedding?: number[] }[] };
		const vec = body.data?.[0]?.embedding;
		if (!Array.isArray(vec)) return fallbackSemanticToLexical(db, wikiId, query, topK);
		queryVec = vec;
	} catch {
		return fallbackSemanticToLexical(db, wikiId, query, topK);
	}

	const scored: { filePath: string; chunkText: string; score: number }[] = [];
	for (const row of chunkRows) {
		try {
			const emb = JSON.parse(row.embedding) as number[];
			const score = cosine(queryVec, emb);
			if (Number.isFinite(score)) {
				scored.push({ filePath: row.file_path, chunkText: row.chunk_text, score });
			}
		} catch {}
	}
	scored.sort((a, b) => b.score - a.score);
	const top = scored.slice(0, topK);
	if (top.length === 0) return fallbackSemanticToLexical(db, wikiId, query, topK);

	const pages = db
		.prepare("SELECT page_id, title, file_paths FROM wiki_pages WHERE wiki_id = ?")
		.all(wikiId) as { page_id: string; title: string; file_paths: string | null }[];
	const fileToPages = new Map<string, { pageId: string; title: string }[]>();
	for (const page of pages) {
		const fps = JSON.parse(page.file_paths || "[]") as string[];
		for (const fp of fps) {
			const list = fileToPages.get(fp) ?? [];
			list.push({ pageId: page.page_id, title: page.title });
			fileToPages.set(fp, list);
		}
	}

	const header = loadWikiHeader(db, wikiId);
	const results = top.map((r) => ({
		filePath: r.filePath,
		score: Math.round(r.score * 10000) / 10000,
		snippet: r.chunkText.slice(0, 400) + (r.chunkText.length > 400 ? "..." : ""),
		relatedPages: fileToPages.get(r.filePath) ?? [],
	}));
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify(
					{
						owner: header?.owner ?? null,
						repo: header?.repo ?? null,
						commitSha: header?.commitSha ?? null,
						generatedAt: header?.generatedAt ?? null,
						ageDays: header?.ageDays ?? null,
						mode: "semantic",
						results,
					},
					null,
					2,
				),
			},
		],
	};
}

function fallbackSemanticToLexical(
	db: DbLike,
	wikiId: number,
	query: string,
	topK: number,
): ToolResult {
	const pages = db
		.prepare("SELECT page_id, title, content FROM wiki_pages WHERE wiki_id = ?")
		.all(wikiId) as PageRow[];
	const results = lexicalSearch(pages, query, topK);
	const header = loadWikiHeader(db, wikiId);
	if (results.length === 0) {
		return {
			content: [
				{
					type: "text" as const,
					text: `No results for "${query}" (semantic search unavailable, used lexical fallback).`,
				},
			],
		};
	}
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify(
					{
						owner: header?.owner ?? null,
						repo: header?.repo ?? null,
						commitSha: header?.commitSha ?? null,
						generatedAt: header?.generatedAt ?? null,
						ageDays: header?.ageDays ?? null,
						mode: "lexical",
						note: "semantic_unavailable_fell_back_to_lexical",
						results,
					},
					null,
					2,
				),
			},
		],
	};
}

// ---------------------------------------------------------------------------
// Tool descriptions and registration
// ---------------------------------------------------------------------------
//
// Description style notes (informed by Anthropic "Writing Effective Tools" + 2026
// MCP community guidance): each description opens with the one question this tool
// answers, then lists key parameters, then ends with a concrete example call.
// Keep total tool-description tokens well under 10K so Claude Code does not
// defer-load this server via Tool Search.

export const DESCRIPTIONS = {
	listWikis: `Answer: which wikis are indexed, and what's in each one?

Returns a catalog of every completed wiki: owner/repo/title/pageCount/totalContentChars/commitSha/generatedAt/ageDays plus per-section pageCount/pageIds/totalContentChars. Budget context with totalContentChars before calling get_wiki_pages. By default you get one row per repo (the newest completed generation) with \`historicalCount\` showing how many older generations exist; pass \`includeHistorical: true\` to see every generation. Pass \`query\` for a case-insensitive substring match on owner/repo/title. Pass \`verbose: true\` to also include section/page descriptions and per-page contentChars. Unmatched \`query\` returns an error with ranked \`didYouMean\` suggestions.

Call this first when you don't know which repos are available. If you already know the repo, list_pages is more focused. If page titles aren't enough to pick the right one, use search_wiki.

Example: \`list_wikis({ query: "deepwiki" })\``,

	listPages: `Answer: what's the page outline for one specific wiki?

Returns sections with per-section totalContentChars, plus per-page IDs, titles, short descriptions, and contentChars (so you can budget context before fetching). Wiki-level totalContentChars and commitSha/generatedAt/ageDays are also included. Use this when you already know the owner/repo and don't need the full catalog. Unknown owner/repo returns an error with \`didYouMean\` suggestions.

Example: \`list_pages({ owner: "andyhtran", repo: "deepwiki-by-cc" })\``,

	getWikiPages: `Answer: give me the markdown content of these specific wiki pages.

Bulk fetch. Pass \`pageIds\` (specific pages), \`sectionIds\` (every page in those sections), or both — they're combined, deduplicated, and returned in request order. Cap: 50 resolved pages.

\`mode\` controls per-page output:
  - \`full\` (default): markdown including mermaid diagrams
  - \`no-diagrams\`: markdown with \`\`\`mermaid\`\`\` blocks stripped — use when you just need the prose
  - \`summary\`: content up to first H2 or first 300 words
  - \`outline\`: H1/H2/H3 heading tree as \`{ level, text }[]\` plus per-page contentChars — cheapest "should I fetch this page in full?" signal in a single call
  - \`diagrams\`: just the extracted mermaid blocks
  - \`citations\`: just the source file paths

\`maxCharsPerPage\` truncates each content-bearing page independently. \`maxTotalChars\` caps the aggregate response: pages are consumed in request order until the budget is spent, the page that crosses the line is truncated to fit what's left, and later pages come back as \`{ pageId, title, filePaths, skipped: true, contentChars }\` markers so you can re-request them with a wider budget. Both caps are ignored by outline/diagrams/citations. The envelope flags \`truncated: true\` (per-page), \`truncatedByTotal: true\` (total cap was binding), and \`skippedCount\` (pages dropped by the total cap). Missing pageIds appear as \`{ pageId, missing: true, didYouMean: [...] }\` so partial misses still return what matched.

Example: \`get_wiki_pages({ owner: "andyhtran", repo: "deepwiki-by-cc", pageIds: ["mcp-server"], mode: "no-diagrams" })\``,

	searchWiki: `Answer: which pages best match this query?

Searches page content. \`mode\` defaults to \`semantic\` (embedding cosine similarity); pass \`mode: "lexical"\` for exact keyword/substring matching. Semantic falls back to lexical automatically when embeddings aren't indexed. \`topK\` defaults to 10.

Specify \`owner\`+\`repo\` to scope to one wiki. Omit both for cross-repo search (lexical only — cosine across different embedding models is not comparable, so semantic mode requires owner+repo).

Example: \`search_wiki({ owner: "andyhtran", repo: "deepwiki-by-cc", query: "how does the embedding fallback work" })\`
Cross-repo: \`search_wiki({ query: "audio capture", mode: "lexical" })\``,

	findPagesMentioning: `Answer: which wiki pages cite this source path?

Reverse citation lookup. Case-insensitive substring match against each page's \`file_paths\` list. Use this when you know a file/symbol and want the page that documents it; use search_wiki when you want pages whose content (not citations) match a query. Unknown owner/repo returns an error with \`didYouMean\` suggestions.

Example: \`find_pages_mentioning({ owner: "andyhtran", repo: "deepwiki-by-cc", path: "src/mcp/server.ts" })\``,
};

export function registerTools(server: McpServer, db: DbLike): void {
	const handlers = createHandlers(db);

	server.registerTool(
		"list_wikis",
		{
			title: "List Wikis",
			description: DESCRIPTIONS.listWikis,
			inputSchema: z.object({
				query: z
					.string()
					.optional()
					.describe("Case-insensitive substring match on owner, repo, or title"),
				verbose: z
					.boolean()
					.optional()
					.describe("Include section/page descriptions and per-page contentChars (default false)"),
				includeHistorical: z
					.boolean()
					.optional()
					.describe(
						"Return every completed generation instead of just the newest per repo (default false)",
					),
			}),
		},
		handlers.listWikis,
	);

	server.registerTool(
		"list_pages",
		{
			title: "List Pages",
			description: DESCRIPTIONS.listPages,
			inputSchema: z.object({
				owner: z.string().describe("Repository owner from list_wikis"),
				repo: z.string().describe("Repository name from list_wikis"),
			}),
		},
		handlers.listPages,
	);

	server.registerTool(
		"get_wiki_pages",
		{
			title: "Get Wiki Pages",
			description: DESCRIPTIONS.getWikiPages,
			inputSchema: z.object({
				owner: z.string().describe("Repository owner from list_wikis"),
				repo: z.string().describe("Repository name from list_wikis"),
				pageIds: z.array(z.string()).optional().describe("Specific page IDs from list_pages"),
				sectionIds: z
					.array(z.string())
					.optional()
					.describe("Section IDs (each expanded to all child pages in sort_order)"),
				mode: z
					.enum(["full", "no-diagrams", "summary", "diagrams", "citations", "outline"])
					.optional()
					.describe("Per-page output shape. Default 'full'."),
				maxCharsPerPage: z
					.number()
					.int()
					.min(1)
					.optional()
					.describe("Truncate per-page content to this many characters"),
				maxTotalChars: z
					.number()
					.int()
					.min(1)
					.optional()
					.describe(
						"Cap total content across all pages. When exceeded, later pages become skipped markers",
					),
			}),
		},
		handlers.getWikiPages,
	);

	server.registerTool(
		"search_wiki",
		{
			title: "Search Wiki",
			description: DESCRIPTIONS.searchWiki,
			inputSchema: z.object({
				query: z.string().describe("Search query"),
				owner: z.string().optional().describe("Repository owner (omit with repo for cross-repo)"),
				repo: z.string().optional().describe("Repository name (omit with owner for cross-repo)"),
				mode: z
					.enum(["semantic", "lexical"])
					.optional()
					.describe("Search mode. Default 'semantic'."),
				topK: z.number().int().min(1).max(50).optional().describe("Number of results (default 10)"),
			}),
		},
		handlers.searchWiki,
	);

	server.registerTool(
		"find_pages_mentioning",
		{
			title: "Find Pages Mentioning Path",
			description: DESCRIPTIONS.findPagesMentioning,
			inputSchema: z.object({
				owner: z.string().describe("Repository owner from list_wikis"),
				repo: z.string().describe("Repository name from list_wikis"),
				path: z
					.string()
					.min(1)
					.describe("Source path or fragment (e.g. 'src/mcp/server.ts' or 'Transcriber')"),
			}),
		},
		handlers.findPagesMentioning,
	);
}

// ---------------------------------------------------------------------------
// Server boot
// ---------------------------------------------------------------------------

// Open the production DB only when we're actually starting the server. Tests
// import createHandlers/registerTools without paying for the file open.
function openProductionDb(): DbLike {
	const db = new Database(dbPath, { readonly: true });
	db.exec("PRAGMA journal_mode = WAL");
	return db as unknown as DbLike;
}

function createMcpServer(): McpServer {
	const server = new McpServer({ name: "deepwiki", version: "1.0.0" });
	registerTools(server, openProductionDb());
	return server;
}

const isMain = (() => {
	if (typeof process === "undefined") return false;
	const arg = process.argv?.[1];
	if (!arg) return false;
	const thisFile = fileURLToPath(import.meta.url);
	return arg === thisFile || arg.endsWith("/mcp/server.ts") || arg.endsWith("/mcp/server.js");
})();

if (isMain) {
	if (process.env.MCP_HTTP === "true") {
		// HTTP mode — Streamable HTTP on /mcp for Docker / network access.
		// SDK requires a fresh transport per request in stateless mode, so we
		// also create a fresh McpServer per request to avoid connect() conflicts.
		const port = Number(process.env.MCP_PORT) || 3001;
		const httpServer = createServer(async (req, res) => {
			const url = new URL(req.url || "", `http://localhost:${port}`);

			if (url.pathname === "/mcp") {
				const server = createMcpServer();
				const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
				await server.connect(transport);
				await transport.handleRequest(req, res);
				res.on("close", () => {
					transport.close();
					server.close();
				});
			} else if (url.pathname === "/health") {
				res.writeHead(200).end("ok");
			} else {
				res.writeHead(404).end("Not found");
			}
		});
		// Bind to localhost only — in host-network mode, binding to 0.0.0.0
		// conflicts with Tailscale serve which already forwards the public port.
		const host = process.env.MCP_HOST || "127.0.0.1";
		httpServer.listen(port, host, () => {
			console.error(`deepwiki MCP server running on http://${host}:${port}/mcp`);
		});
	} else {
		const server = createMcpServer();
		const transport = new StdioServerTransport();
		await server.connect(transport);
		console.error("deepwiki MCP server running on stdio");
	}
}
