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

// Resolve DB path: env override, or relative to this script (works from any cwd).
const scriptDir =
	typeof import.meta.dirname === "string"
		? import.meta.dirname
		: join(fileURLToPath(import.meta.url), "..");
const projectRoot = join(scriptDir, "../..");
const dbPath = process.env.DB_PATH || join(projectRoot, "data", "deepwiki.db");
const db = new Database(dbPath, { readonly: true });
db.exec("PRAGMA journal_mode = WAL");

interface WikiRow {
	id: number;
	title: string;
	description: string | null;
	structure: string;
	status: string;
	owner: string | null;
	repo_name: string | null;
	page_count: number;
}

interface PageRow {
	page_id: string;
	title: string;
	content: string | null;
	file_paths: string | null;
}

function getWikiId(owner: string, repo: string): number | null {
	// Try exact match first, then fall back to repo-name-only match.
	// Agents often guess the wrong owner (e.g. "andyhtran" instead of "local").
	const row = db
		.prepare(
			`SELECT w.id FROM wikis w
			 JOIN repos r ON r.id = w.repo_id
			 WHERE r.owner = ?1 AND r.name = ?2 AND w.status = 'completed'
			 ORDER BY w.updated_at DESC LIMIT 1`,
		)
		.get(owner, repo) as { id: number } | undefined;
	if (row) return row.id;

	const fuzzy = db
		.prepare(
			`SELECT w.id FROM wikis w
			 JOIN repos r ON r.id = w.repo_id
			 WHERE LOWER(r.name) = LOWER(?1) AND w.status = 'completed'
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

function getAvailableWikis(): string[] {
	const rows = db
		.prepare(
			`SELECT DISTINCT r.owner, r.name FROM wikis w
			 JOIN repos r ON r.id = w.repo_id
			 WHERE w.status = 'completed' ORDER BY r.owner, r.name`,
		)
		.all() as { owner: string; name: string }[];
	return rows.map((r) => `${r.owner}/${r.name}`);
}

function formatPage(page: PageRow): string {
	const filePaths = JSON.parse(page.file_paths || "[]") as string[];
	const header = [`# ${page.title}`];
	if (filePaths.length > 0) {
		header.push(`Source files: ${filePaths.join(", ")}`);
	}
	header.push("");
	return `${header.join("\n")}${page.content || ""}`;
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

// Semantic retrieval helpers — lightweight cosine scan over stored embeddings
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

interface ChunkRow {
	chunk_id: number;
	file_path: string;
	chunk_seq: number;
	chunk_text: string;
	offset_start: number;
	offset_end: number;
	embedding: string;
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

function getRepoIdForWiki(wikiId: number): number | null {
	const row = db.prepare("SELECT repo_id FROM wikis WHERE id = ?1").get(wikiId) as
		| {
				repo_id: number;
		  }
		| undefined;
	return row?.repo_id ?? null;
}

// Read embedding config from settings table
function getEmbeddingSetting(key: string): string | null {
	const row = db.prepare("SELECT value FROM settings WHERE key = ?1").get(key) as
		| {
				value: string;
		  }
		| undefined;
	return row?.value ?? null;
}

/** Lexical fallback when embeddings aren't available */
function fallbackToLexical(
	wikiId: number,
	query: string,
): { content: { type: "text"; text: string }[] } {
	const pages = db
		.prepare("SELECT page_id, title, content FROM wiki_pages WHERE wiki_id = ?1")
		.all(wikiId) as PageRow[];

	const words = query
		.toLowerCase()
		.split(/\s+/)
		.filter((w) => w.length > 0);

	const results = pages
		.map((p) => {
			const title = p.title.toLowerCase();
			const content = p.content?.toLowerCase() || "";
			const hasMatch = words.some((w) => title.includes(w) || content.includes(w));
			if (!hasMatch) return null;

			const score = scoreMatch(words, p.title, p.content);
			let snippet = "";
			if (p.content) {
				snippet = `${p.content.slice(0, 300).trim()}...`;
			}
			return { pageId: p.page_id, title: p.title, score, snippet, mode: "lexical" as const };
		})
		.filter((r): r is NonNullable<typeof r> => r !== null)
		.sort((a, b) => b.score - a.score)
		.slice(0, 5);

	if (results.length === 0) {
		return {
			content: [
				{
					type: "text" as const,
					text: `No results found for "${query}" (semantic search unavailable, used lexical fallback).`,
				},
			],
		};
	}

	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({ mode: "lexical_fallback", results }, null, 2),
			},
		],
	};
}

// Creates a fully configured McpServer instance. In HTTP stateless mode the SDK
// requires a fresh transport (and therefore server) per request — this factory
// avoids duplicating the tool registration code.
function createMcpServer(): McpServer {
	const server = new McpServer({
		name: "deepwiki",
		version: "1.0.0",
	});
	registerTools(server);
	return server;
}

function registerTools(server: McpServer): void {
	server.registerTool(
		"list_wikis",
		{
			title: "List Wikis",
			description:
				"Call this first to discover available wikis and their structure. Returns wikis with a compact outline showing section IDs, page IDs, titles, and descriptions. Use these IDs with get_wiki_page, get_section_pages, or search_wiki.",
			inputSchema: z.object({}),
		},
		async () => {
			const wikis = db
				.prepare(
					`SELECT w.id, w.title, w.description, w.structure, w.status, r.owner, r.name as repo_name,
				(SELECT COUNT(*) FROM wiki_pages wp WHERE wp.wiki_id = w.id) as page_count
			 FROM wikis w
			 LEFT JOIN repos r ON r.id = w.repo_id
			 WHERE w.status = 'completed'
			 ORDER BY w.updated_at DESC`,
				)
				.all() as WikiRow[];

			const result = wikis.map((w) => {
				const full = JSON.parse(w.structure);
				const sections = full.sections.map(
					(s: {
						id: string;
						title: string;
						description?: string;
						pages: { id: string; title: string; description?: string }[];
					}) => ({
						id: s.id,
						title: s.title,
						description: s.description || "",
						pages: s.pages.map((p: { id: string; title: string; description?: string }) => ({
							id: p.id,
							title: p.title,
							description: p.description || "",
						})),
					}),
				);
				return {
					owner: w.owner,
					repo: w.repo_name,
					title: w.title,
					description: w.description,
					pageCount: w.page_count,
					sections,
				};
			});

			return {
				content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	server.registerTool(
		"get_wiki_page",
		{
			title: "Get Wiki Page",
			description:
				"Get the full markdown content of a single wiki page. Use list_wikis to find available page IDs.",
			inputSchema: z.object({
				owner: z.string().describe("Repository owner from list_wikis"),
				repo: z.string().describe("Repository name from list_wikis"),
				pageId: z.string().describe("Page ID from the wiki outline (e.g. 'getting-started')"),
			}),
		},
		async ({ owner, repo, pageId }) => {
			const wikiId = getWikiId(owner, repo);
			if (!wikiId) {
				const available = getAvailableWikis();
				const suffix = available.length > 0 ? ` Available wikis: ${available.join(", ")}` : "";
				return {
					content: [
						{ type: "text" as const, text: `No wiki found for ${owner}/${repo}.${suffix}` },
					],
					isError: true,
				};
			}
			const page = db
				.prepare(
					"SELECT page_id, title, content, file_paths FROM wiki_pages WHERE wiki_id = ?1 AND page_id = ?2",
				)
				.get(wikiId, pageId) as PageRow | undefined;

			if (!page) {
				const pages = db
					.prepare("SELECT page_id FROM wiki_pages WHERE wiki_id = ?1")
					.all(wikiId) as {
					page_id: string;
				}[];
				const available = pages.map((p) => p.page_id).join(", ");
				return {
					content: [
						{
							type: "text" as const,
							text: `Page "${pageId}" not found. Available pages: ${available}`,
						},
					],
					isError: true,
				};
			}

			return {
				content: [{ type: "text" as const, text: formatPage(page) }],
			};
		},
	);

	server.registerTool(
		"get_section_pages",
		{
			title: "Get Section Pages",
			description:
				"Get the full markdown content of all pages in a wiki section at once. More efficient than multiple get_wiki_page calls when you need several related pages. Use section IDs from list_wikis.",
			inputSchema: z.object({
				owner: z.string().describe("Repository owner from list_wikis"),
				repo: z.string().describe("Repository name from list_wikis"),
				sectionId: z
					.string()
					.describe("Section ID from the wiki outline (e.g. 'architecture', 'overview')"),
			}),
		},
		async ({ owner, repo, sectionId }) => {
			const wikiId = getWikiId(owner, repo);
			if (!wikiId) {
				const available = getAvailableWikis();
				const suffix = available.length > 0 ? ` Available wikis: ${available.join(", ")}` : "";
				return {
					content: [
						{ type: "text" as const, text: `No wiki found for ${owner}/${repo}.${suffix}` },
					],
					isError: true,
				};
			}
			const pages = db
				.prepare(
					"SELECT page_id, title, content, file_paths FROM wiki_pages WHERE wiki_id = ?1 AND parent_id = ?2 ORDER BY sort_order",
				)
				.all(wikiId, sectionId) as PageRow[];

			if (pages.length === 0) {
				const sections = db
					.prepare(
						"SELECT DISTINCT parent_id FROM wiki_pages WHERE wiki_id = ?1 ORDER BY parent_id",
					)
					.all(wikiId) as { parent_id: string }[];
				const available = sections.map((s) => s.parent_id).join(", ");
				return {
					content: [
						{
							type: "text" as const,
							text: `Section "${sectionId}" not found. Available sections: ${available}`,
						},
					],
					isError: true,
				};
			}

			const output = pages.map((p) => formatPage(p)).join("\n\n---\n\n");

			return {
				content: [{ type: "text" as const, text: output }],
			};
		},
	);

	server.registerTool(
		"search_wiki",
		{
			title: "Search Wiki",
			description:
				"Search wiki pages by keyword. Matches pages containing any search word (OR semantics), ranked by relevance. Returns top 5 results with snippets. Matches against page titles (weighted higher) and content.",
			inputSchema: z.object({
				owner: z.string().describe("Repository owner from list_wikis"),
				repo: z.string().describe("Repository name from list_wikis"),
				query: z.string().describe("Search term to match against page titles and content"),
			}),
		},
		async ({ owner, repo, query }) => {
			const wikiId = getWikiId(owner, repo);
			if (!wikiId) {
				const available = getAvailableWikis();
				const suffix = available.length > 0 ? ` Available wikis: ${available.join(", ")}` : "";
				return {
					content: [
						{ type: "text" as const, text: `No wiki found for ${owner}/${repo}.${suffix}` },
					],
					isError: true,
				};
			}
			const trimmedQuery = query.trim();
			if (trimmedQuery.length === 0) {
				return {
					content: [{ type: "text" as const, text: "Search query cannot be empty." }],
					isError: true,
				};
			}

			const pages = db
				.prepare("SELECT page_id, title, content FROM wiki_pages WHERE wiki_id = ?1")
				.all(wikiId) as PageRow[];

			const words = trimmedQuery
				.toLowerCase()
				.split(/\s+/)
				.filter((w) => w.length > 0);

			const results = pages
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
				.slice(0, 5);

			if (results.length === 0) {
				const allPages = pages.map((p) => `${p.page_id}: ${p.title}`).join("\n");
				return {
					content: [
						{
							type: "text" as const,
							text: `No pages matched "${query}". Available pages:\n${allPages}`,
						},
					],
				};
			}

			return {
				content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
			};
		},
	);

	server.registerTool(
		"search_wiki_semantic",
		{
			title: "Semantic Search Wiki",
			description:
				"Search wiki content using semantic similarity (embedding-based). Requires embeddings to be enabled and indexed. Falls back to lexical search if embeddings are unavailable. Returns top results ranked by relevance score.",
			inputSchema: z.object({
				owner: z.string().describe("Repository owner from list_wikis"),
				repo: z.string().describe("Repository name from list_wikis"),
				query: z.string().describe("Natural language query for semantic search"),
				topK: z.number().int().min(1).max(50).optional().describe("Number of results (default 10)"),
			}),
		},
		async ({ owner, repo, query, topK }) => {
			const wikiId = getWikiId(owner, repo);
			if (!wikiId) {
				const available = getAvailableWikis();
				const suffix = available.length > 0 ? ` Available wikis: ${available.join(", ")}` : "";
				return {
					content: [
						{ type: "text" as const, text: `No wiki found for ${owner}/${repo}.${suffix}` },
					],
					isError: true,
				};
			}

			const trimmedQuery = query.trim();
			if (trimmedQuery.length === 0) {
				return {
					content: [{ type: "text" as const, text: "Search query cannot be empty." }],
					isError: true,
				};
			}

			const repoId = getRepoIdForWiki(wikiId);
			if (!repoId) {
				return {
					content: [{ type: "text" as const, text: "Could not resolve repo for this wiki." }],
					isError: true,
				};
			}

			// Check if embeddings are available for this repo
			const embModel = getEmbeddingSetting("embeddingsModel") || "text-embedding-3-small";
			const embBaseUrl =
				getEmbeddingSetting("embeddingsBaseUrl") || "https://api.openai.com/v1/embeddings";
			const embApiKey = getEmbeddingSetting("embeddingsApiKey") || "";

			// Derive endpoint fingerprint so we only match embeddings from the same provider
			const embFingerprint = computeEndpointFingerprint(embBaseUrl);

			// Load chunk embeddings for the repo, filtered by model AND endpoint fingerprint
			const chunkRows = db
				.prepare(
					`SELECT c.id AS chunk_id, c.file_path, c.chunk_seq, c.chunk_text,
				        c.offset_start, c.offset_end, e.embedding
				 FROM document_chunks c
				 INNER JOIN chunk_embeddings e ON e.chunk_id = c.id
				 WHERE c.repo_id = ?1
				   AND e.embedding_model = ?2
				   AND e.endpoint_fingerprint = ?3
				 ORDER BY c.file_path, c.chunk_seq`,
				)
				.all(repoId, embModel, embFingerprint) as ChunkRow[];

			if (chunkRows.length === 0) {
				// No embeddings — fall back to lexical search
				return fallbackToLexical(wikiId, trimmedQuery);
			}

			// Embed the query
			let queryVec: number[];
			try {
				const endpoint = embBaseUrl.trim().replace(/\/+$/, "");
				const url = endpoint.endsWith("/embeddings")
					? endpoint
					: endpoint.endsWith("/v1")
						? `${endpoint}/embeddings`
						: `${endpoint}/v1/embeddings`;

				const headers: Record<string, string> = { "Content-Type": "application/json" };
				if (embApiKey.trim().length > 0) {
					headers.Authorization = `Bearer ${embApiKey}`;
				}

				const resp = await fetch(url, {
					method: "POST",
					headers,
					body: JSON.stringify({ model: embModel, input: [trimmedQuery] }),
					signal: AbortSignal.timeout(15_000),
				});

				if (!resp.ok) {
					return fallbackToLexical(wikiId, trimmedQuery);
				}

				const body = (await resp.json()) as { data?: { embedding?: number[] }[] };
				const vec = body.data?.[0]?.embedding;
				if (!Array.isArray(vec)) {
					return fallbackToLexical(wikiId, trimmedQuery);
				}
				queryVec = vec;
			} catch {
				return fallbackToLexical(wikiId, trimmedQuery);
			}

			// Score all chunks by cosine similarity
			const limit = topK ?? 10;
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
			const topResults = scored.slice(0, limit);

			if (topResults.length === 0) {
				return fallbackToLexical(wikiId, trimmedQuery);
			}

			// Map file paths to wiki pages for context
			const pages = db
				.prepare("SELECT page_id, title, file_paths FROM wiki_pages WHERE wiki_id = ?1")
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

			const results = topResults.map((r) => ({
				filePath: r.filePath,
				score: Math.round(r.score * 10000) / 10000,
				snippet: r.chunkText.slice(0, 400) + (r.chunkText.length > 400 ? "..." : ""),
				relatedPages: fileToPages.get(r.filePath) ?? [],
			}));

			return {
				content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
			};
		},
	);
} // end registerTools

if (process.env.MCP_HTTP === "true") {
	// HTTP mode — Streamable HTTP on /mcp for Docker / network access.
	// The SDK requires a fresh transport per request in stateless mode,
	// so we also create a fresh McpServer per request to avoid connect() conflicts.
	const port = Number(process.env.MCP_PORT) || 3001;
	const httpServer = createServer(async (req, res) => {
		const url = new URL(req.url || "", `http://localhost:${port}`);

		if (url.pathname === "/mcp") {
			const server = createMcpServer();
			const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
			await server.connect(transport);
			await transport.handleRequest(req, res);
			// Clean up ephemeral instances once the response finishes to prevent leaks
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
	// Stdio mode — default for local dev (bun run mcp)
	const server = createMcpServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("deepwiki MCP server running on stdio");
}
