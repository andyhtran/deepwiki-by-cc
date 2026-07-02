import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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

beforeAll(() => {
	db = setupDb();
});

afterAll(() => {
	db.close();
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
