// Redirect console.log to stderr — MCP uses stdout for JSON-RPC protocol.
console.log = (...args: unknown[]) => console.error(...args);

import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// Resolve DB path: env override, or relative to this script (works from any cwd).
const scriptDir = typeof import.meta.dirname === "string"
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
				content: [{ type: "text" as const, text: `No wiki found for ${owner}/${repo}.${suffix}` }],
				isError: true,
			};
		}
		const page = db
			.prepare(
				"SELECT page_id, title, content, file_paths FROM wiki_pages WHERE wiki_id = ?1 AND page_id = ?2",
			)
			.get(wikiId, pageId) as PageRow | undefined;

		if (!page) {
			const pages = db.prepare("SELECT page_id FROM wiki_pages WHERE wiki_id = ?1").all(wikiId) as {
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
				content: [{ type: "text" as const, text: `No wiki found for ${owner}/${repo}.${suffix}` }],
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
				.prepare("SELECT DISTINCT parent_id FROM wiki_pages WHERE wiki_id = ?1 ORDER BY parent_id")
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
				content: [{ type: "text" as const, text: `No wiki found for ${owner}/${repo}.${suffix}` }],
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
	httpServer.listen(port, () => {
		console.error(`deepwiki MCP server running on http://0.0.0.0:${port}/mcp`);
	});
} else {
	// Stdio mode — default for local dev (bun run mcp)
	const server = createMcpServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("deepwiki MCP server running on stdio");
}
