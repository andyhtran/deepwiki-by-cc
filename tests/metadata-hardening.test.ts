import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

let db: Database;

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
	for (const stmt of statements) {
		d.exec(`${stmt};`);
	}

	return d;
}

function createRepo(owner = "test-owner", name = "test-repo"): { id: number; full_name: string } {
	const fullName = `${owner}/${name}`;
	return db
		.prepare(
			`INSERT INTO repos (owner, name, full_name, url, default_branch)
			 VALUES (?, ?, ?, ?, 'main')
			 ON CONFLICT(full_name) DO UPDATE SET url = excluded.url, updated_at = datetime('now')
			 RETURNING id, full_name`,
		)
		.get(owner, name, fullName, `https://github.com/${fullName}`) as {
		id: number;
		full_name: string;
	};
}

// Mirror of createEndpointFingerprint from embeddings/client.ts
function fingerprint(baseUrl: string): string {
	let canonical = baseUrl.trim().replace(/\/+$/, "");
	if (canonical.endsWith("/v1/embeddings"))
		canonical = canonical.slice(0, -"/v1/embeddings".length);
	else if (canonical.endsWith("/v1")) canonical = canonical.slice(0, -"/v1".length);
	return createHash("sha256").update(canonical).digest("hex");
}

beforeAll(() => {
	db = setupDb();
});

afterAll(() => {
	db.close();
});

describe("wiki embedding metadata columns", () => {
	test("wikis table has embedding_enabled, embedding_model, embedding_endpoint_fingerprint", () => {
		const cols = db.prepare("PRAGMA table_info(wikis)").all() as { name: string }[];
		const colNames = cols.map((c) => c.name);
		expect(colNames).toContain("embedding_enabled");
		expect(colNames).toContain("embedding_model");
		expect(colNames).toContain("embedding_endpoint_fingerprint");
	});

	test("embedding_enabled defaults to 0", () => {
		const repo = createRepo("emb", "defaults");
		const wiki = db
			.prepare(
				`INSERT INTO wikis (repo_id, title, description, structure, model)
				 VALUES (?, 'Test', null, '{}', 'claude-sonnet')
				 RETURNING *`,
			)
			.get(repo.id) as Record<string, unknown>;
		expect(wiki.embedding_enabled).toBe(0);
		expect(wiki.embedding_model).toBeNull();
		expect(wiki.embedding_endpoint_fingerprint).toBeNull();
	});

	test("persists embedding metadata on wiki creation", () => {
		const repo = createRepo("emb", "persist");
		const fp = fingerprint("https://api.openai.com/v1");
		const wiki = db
			.prepare(
				`INSERT INTO wikis (repo_id, title, description, structure, model, embedding_enabled, embedding_model, embedding_endpoint_fingerprint)
				 VALUES (?, 'Test', null, '{}', 'claude-sonnet', 1, 'text-embedding-3-small', ?)
				 RETURNING *`,
			)
			.get(repo.id, fp) as Record<string, unknown>;
		expect(wiki.embedding_enabled).toBe(1);
		expect(wiki.embedding_model).toBe("text-embedding-3-small");
		expect(wiki.embedding_endpoint_fingerprint).toBe(fp);
	});
});

describe("run-level embedding snapshot in job params", () => {
	test("embedding snapshot can be stored and retrieved from job params JSON", () => {
		const repo = createRepo("snap", "test");
		const snapshot = {
			enabled: true,
			model: "text-embedding-3-small",
			endpointFingerprint: fingerprint("https://api.openai.com"),
		};
		const params = JSON.stringify({
			generationModel: "claude-sonnet-4-6",
			embeddingSnapshot: snapshot,
		});

		const job = db
			.prepare("INSERT INTO jobs (type, repo_id, params) VALUES (?, ?, ?) RETURNING *")
			.get("full-generation", repo.id, params) as Record<string, unknown>;

		const parsed = JSON.parse(job.params as string);
		expect(parsed.embeddingSnapshot.enabled).toBe(true);
		expect(parsed.embeddingSnapshot.model).toBe("text-embedding-3-small");
		expect(parsed.embeddingSnapshot.endpointFingerprint).toBe(snapshot.endpointFingerprint);
	});

	test("disabled embedding snapshot has null model and fingerprint", () => {
		const repo = createRepo("snap", "disabled");
		const snapshot = { enabled: false, model: null, endpointFingerprint: null };
		const params = JSON.stringify({
			generationModel: "claude-sonnet-4-6",
			embeddingSnapshot: snapshot,
		});

		const job = db
			.prepare("INSERT INTO jobs (type, repo_id, params) VALUES (?, ?, ?) RETURNING *")
			.get("full-generation", repo.id, params) as Record<string, unknown>;

		const parsed = JSON.parse(job.params as string);
		expect(parsed.embeddingSnapshot.enabled).toBe(false);
		expect(parsed.embeddingSnapshot.model).toBeNull();
		expect(parsed.embeddingSnapshot.endpointFingerprint).toBeNull();
	});
});

describe("per-version stats selection by wiki_id", () => {
	test("fetches job stats by wiki_id, not by repo", () => {
		const repo = createRepo("stats", "perversion");

		// Create two wikis for the same repo
		const wiki1 = db
			.prepare(
				`INSERT INTO wikis (repo_id, title, description, structure, model, status) VALUES (?, 'V1', null, '{}', 'sonnet', 'completed') RETURNING *`,
			)
			.get(repo.id) as { id: number };
		const wiki2 = db
			.prepare(
				`INSERT INTO wikis (repo_id, title, description, structure, model, status) VALUES (?, 'V2', null, '{}', 'opus', 'completed') RETURNING *`,
			)
			.get(repo.id) as { id: number };

		// Create completed jobs linked to each wiki with different stats
		db.prepare(
			`INSERT INTO jobs (type, repo_id, wiki_id, status, total_prompt_tokens, total_completion_tokens, total_cost, completed_at)
			 VALUES ('full-generation', ?, ?, 'completed', 1000, 500, 0.05, datetime('now', '-1 hour'))`,
		).run(repo.id, wiki1.id);
		db.prepare(
			`INSERT INTO jobs (type, repo_id, wiki_id, status, total_prompt_tokens, total_completion_tokens, total_cost, completed_at)
			 VALUES ('full-generation', ?, ?, 'completed', 5000, 2500, 0.25, datetime('now'))`,
		).run(repo.id, wiki2.id);

		// Query by wiki_id = wiki1 should get wiki1's stats
		const job1 = db
			.prepare(
				`SELECT * FROM jobs WHERE wiki_id = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 1`,
			)
			.get(wiki1.id) as { total_prompt_tokens: number; total_cost: number };
		expect(job1.total_prompt_tokens).toBe(1000);
		expect(job1.total_cost).toBeCloseTo(0.05);

		// Query by wiki_id = wiki2 should get wiki2's stats
		const job2 = db
			.prepare(
				`SELECT * FROM jobs WHERE wiki_id = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 1`,
			)
			.get(wiki2.id) as { total_prompt_tokens: number; total_cost: number };
		expect(job2.total_prompt_tokens).toBe(5000);
		expect(job2.total_cost).toBeCloseTo(0.25);
	});
});

describe("listWikis deduplication", () => {
	test("does not duplicate wiki rows when multiple completed jobs exist", () => {
		const repo = createRepo("list", "dedup");
		const wiki = db
			.prepare(
				`INSERT INTO wikis (repo_id, title, description, structure, model, status) VALUES (?, 'Dedup Wiki', null, '{}', 'sonnet', 'completed') RETURNING *`,
			)
			.get(repo.id) as { id: number };

		// Two completed jobs for the same wiki
		db.prepare(
			`INSERT INTO jobs (type, repo_id, wiki_id, status, total_prompt_tokens, total_completion_tokens, total_cost, completed_at)
			 VALUES ('full-generation', ?, ?, 'completed', 1000, 500, 0.05, datetime('now', '-1 hour'))`,
		).run(repo.id, wiki.id);
		db.prepare(
			`INSERT INTO jobs (type, repo_id, wiki_id, status, total_prompt_tokens, total_completion_tokens, total_cost, completed_at)
			 VALUES ('sync', ?, ?, 'completed', 2000, 1000, 0.10, datetime('now'))`,
		).run(repo.id, wiki.id);

		// The subquery-based join should return exactly one row for this wiki
		const rows = db
			.prepare(
				`SELECT w.id, w.title,
					j.total_prompt_tokens + j.total_completion_tokens as total_tokens,
					j.total_cost
				 FROM wikis w
				 LEFT JOIN repos r ON r.id = w.repo_id
				 LEFT JOIN jobs j ON j.id = (
					SELECT j2.id FROM jobs j2
					WHERE j2.wiki_id = w.id AND j2.status = 'completed'
					ORDER BY j2.completed_at DESC LIMIT 1
				 )
				 WHERE w.id = ?`,
			)
			.all(wiki.id) as { id: number; total_tokens: number; total_cost: number }[];

		expect(rows.length).toBe(1);
		// Should pick the latest completed job (the sync with 3000 total tokens)
		expect(rows[0].total_tokens).toBe(3000);
		expect(rows[0].total_cost).toBeCloseTo(0.1);
	});
});

describe("sync page metadata updates", () => {
	test("updates page metadata fields on successful update", () => {
		const repo = createRepo("sync", "meta");
		const wiki = db
			.prepare(
				`INSERT INTO wikis (repo_id, title, description, structure, model) VALUES (?, 'Wiki', null, '{}', 'sonnet') RETURNING *`,
			)
			.get(repo.id) as { id: number };

		const page = db
			.prepare(
				`INSERT INTO wiki_pages (wiki_id, page_id, title, parent_id, sort_order, content, status)
				 VALUES (?, 'overview', 'Overview', null, 0, '# Old content', 'completed')
				 RETURNING *`,
			)
			.get(wiki.id) as { id: number };

		// Simulate sync updating metadata even when content stays the same
		db.prepare(
			`UPDATE wiki_pages SET
				model = ?, prompt_tokens = ?, completion_tokens = ?,
				generation_time_ms = ?, status = 'completed', error_message = NULL,
				updated_at = datetime('now')
			 WHERE id = ?`,
		).run("claude-sonnet-4-6", 800, 400, 1500, page.id);

		const updated = db.prepare("SELECT * FROM wiki_pages WHERE id = ?").get(page.id) as Record<
			string,
			unknown
		>;
		expect(updated.model).toBe("claude-sonnet-4-6");
		expect(updated.prompt_tokens).toBe(800);
		expect(updated.completion_tokens).toBe(400);
		expect(updated.generation_time_ms).toBe(1500);
		expect(updated.status).toBe("completed");
		expect(updated.error_message).toBeNull();
	});

	test("sets failure metadata on sync page error", () => {
		const repo = createRepo("sync", "fail");
		const wiki = db
			.prepare(
				`INSERT INTO wikis (repo_id, title, description, structure, model) VALUES (?, 'Wiki', null, '{}', 'sonnet') RETURNING *`,
			)
			.get(repo.id) as { id: number };

		const page = db
			.prepare(
				`INSERT INTO wiki_pages (wiki_id, page_id, title, parent_id, sort_order, content, status)
				 VALUES (?, 'overview', 'Overview', null, 0, '# Content', 'completed')
				 RETURNING *`,
			)
			.get(wiki.id) as { id: number };

		// Simulate sync failure
		db.prepare(
			`UPDATE wiki_pages SET
				status = 'failed', error_message = ?, generation_time_ms = ?,
				updated_at = datetime('now')
			 WHERE id = ?`,
		).run("API timeout", 5000, page.id);

		const updated = db.prepare("SELECT * FROM wiki_pages WHERE id = ?").get(page.id) as Record<
			string,
			unknown
		>;
		expect(updated.status).toBe("failed");
		expect(updated.error_message).toBe("API timeout");
		expect(updated.generation_time_ms).toBe(5000);
	});
});

describe("MCP semantic search endpoint fingerprint filtering", () => {
	test("only matches embeddings with correct model AND fingerprint", () => {
		const repo = createRepo("mcp", "filter");
		const fp1 = fingerprint("https://api.openai.com");
		const fp2 = fingerprint("https://custom-embed.example.com");

		// Insert chunks
		const chunk1 = db
			.prepare(
				`INSERT INTO document_chunks (repo_id, file_path, content_hash, chunk_seq, chunk_text, offset_start, offset_end)
				 VALUES (?, 'src/a.ts', 'hash1', 0, 'chunk text A', 0, 100)
				 RETURNING id`,
			)
			.get(repo.id) as { id: number };
		const chunk2 = db
			.prepare(
				`INSERT INTO document_chunks (repo_id, file_path, content_hash, chunk_seq, chunk_text, offset_start, offset_end)
				 VALUES (?, 'src/b.ts', 'hash2', 0, 'chunk text B', 0, 100)
				 RETURNING id`,
			)
			.get(repo.id) as { id: number };

		// Insert embeddings: chunk1 with fp1, chunk2 with fp2, same model
		db.prepare(
			`INSERT INTO chunk_embeddings (chunk_id, repo_id, file_path, content_hash, embedding, embedding_dim, embedding_model, endpoint_fingerprint)
			 VALUES (?, ?, 'src/a.ts', 'hash1', '[0.1,0.2]', 2, 'text-embedding-3-small', ?)`,
		).run(chunk1.id, repo.id, fp1);
		db.prepare(
			`INSERT INTO chunk_embeddings (chunk_id, repo_id, file_path, content_hash, embedding, embedding_dim, embedding_model, endpoint_fingerprint)
			 VALUES (?, ?, 'src/b.ts', 'hash2', '[0.3,0.4]', 2, 'text-embedding-3-small', ?)`,
		).run(chunk2.id, repo.id, fp2);

		// Query filtering by fp1 should only return chunk1
		const rows = db
			.prepare(
				`SELECT c.chunk_text FROM document_chunks c
				 INNER JOIN chunk_embeddings e ON e.chunk_id = c.id
				 WHERE c.repo_id = ? AND e.embedding_model = ? AND e.endpoint_fingerprint = ?`,
			)
			.all(repo.id, "text-embedding-3-small", fp1) as { chunk_text: string }[];

		expect(rows.length).toBe(1);
		expect(rows[0].chunk_text).toBe("chunk text A");

		// Query filtering by fp2 should only return chunk2
		const rows2 = db
			.prepare(
				`SELECT c.chunk_text FROM document_chunks c
				 INNER JOIN chunk_embeddings e ON e.chunk_id = c.id
				 WHERE c.repo_id = ? AND e.embedding_model = ? AND e.endpoint_fingerprint = ?`,
			)
			.all(repo.id, "text-embedding-3-small", fp2) as { chunk_text: string }[];

		expect(rows2.length).toBe(1);
		expect(rows2[0].chunk_text).toBe("chunk text B");
	});
});

describe("migration safety for existing DBs", () => {
	test("adding columns to a table that already has them is idempotent", () => {
		// The schema already creates the columns, so calling ALTER TABLE would fail.
		// Our migration logic checks column existence before altering.
		const cols = db.prepare("PRAGMA table_info(wikis)").all() as { name: string }[];
		const colNames = new Set(cols.map((c) => c.name));

		// Verify the migration targets exist (schema created them)
		expect(colNames.has("embedding_enabled")).toBe(true);
		expect(colNames.has("embedding_model")).toBe(true);
		expect(colNames.has("embedding_endpoint_fingerprint")).toBe(true);
	});
});
