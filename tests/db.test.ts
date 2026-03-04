import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// We set up an in-memory database directly (bypassing getDb() which uses better-sqlite3)
// using bun:sqlite, applying the same schema.sql.
//
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

function createRepo(
	owner = "test-owner",
	name = "test-repo",
	url = "https://github.com/test-owner/test-repo",
): { id: number; full_name: string } {
	const fullName = `${owner}/${name}`;
	const row = db
		.prepare(
			`INSERT INTO repos (owner, name, full_name, url, default_branch)
			 VALUES (?, ?, ?, ?, 'main')
			 ON CONFLICT(full_name) DO UPDATE SET url = excluded.url, updated_at = datetime('now')
			 RETURNING id, full_name`,
		)
		.get(owner, name, fullName, url) as { id: number; full_name: string };
	return row;
}

function createDocument(repoId: number, filePath = "src/index.ts", content = "console.log('hi')") {
	return db
		.prepare(
			`INSERT INTO documents (repo_id, file_path, language, content, content_hash)
			 VALUES (?, ?, 'typescript', ?, 'hash123')
			 RETURNING *`,
		)
		.get(repoId, filePath, content) as Record<string, unknown>;
}

beforeAll(() => {
	db = setupDb();
});

afterAll(() => {
	db.close();
});

describe("schema", () => {
	test("creates all expected tables", () => {
		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
			.all() as { name: string }[];
		const names = tables.map((t) => t.name);
		expect(names).toContain("repos");
		expect(names).toContain("documents");
		expect(names).toContain("wikis");
		expect(names).toContain("wiki_pages");
		expect(names).toContain("jobs");
	});

	test("creates expected indexes", () => {
		const indexes = db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'")
			.all() as { name: string }[];
		const names = indexes.map((i) => i.name);
		expect(names).toContain("idx_documents_repo");
		expect(names).toContain("idx_jobs_status");
	});
});

describe("repos", () => {
	test("create and get", () => {
		const repo = createRepo("acme", "lib");
		expect(repo.id).toBeGreaterThan(0);
		expect(repo.full_name).toBe("acme/lib");

		const row = db.prepare("SELECT * FROM repos WHERE id = ?").get(repo.id) as Record<
			string,
			unknown
		>;
		expect(row.owner).toBe("acme");
		expect(row.name).toBe("lib");
	});

	test("getByFullName", () => {
		createRepo("org", "project");
		const row = db.prepare("SELECT * FROM repos WHERE full_name = ?").get("org/project") as Record<
			string,
			unknown
		>;
		expect(row).toBeDefined();
		expect(row.owner).toBe("org");
	});

	test("upsert on conflict updates url", () => {
		createRepo("dup", "repo", "https://old.com");
		const updated = createRepo("dup", "repo", "https://new.com");
		const row = db.prepare("SELECT url FROM repos WHERE id = ?").get(updated.id) as { url: string };
		expect(row.url).toBe("https://new.com");
	});

	test("update fields", () => {
		const repo = createRepo("upd", "repo");
		db.prepare("UPDATE repos SET clone_path = ?, updated_at = datetime('now') WHERE id = ?").run(
			"/tmp/clone",
			repo.id,
		);
		const row = db.prepare("SELECT clone_path FROM repos WHERE id = ?").get(repo.id) as {
			clone_path: string;
		};
		expect(row.clone_path).toBe("/tmp/clone");
	});

	test("list returns repos", () => {
		const repos = db.prepare("SELECT * FROM repos ORDER BY updated_at DESC").all();
		expect(repos.length).toBeGreaterThan(0);
	});

	test("delete cascades to documents", () => {
		const repo = createRepo("del", "cascade");
		createDocument(repo.id);
		db.prepare("DELETE FROM repos WHERE id = ?").run(repo.id);
		const docs = db.prepare("SELECT * FROM documents WHERE repo_id = ?").all(repo.id);
		expect(docs.length).toBe(0);
	});
});

describe("documents", () => {
	test("insert and get by repo", () => {
		const repo = createRepo("doc", "test");
		createDocument(repo.id, "src/a.ts", "const a = 1;");
		createDocument(repo.id, "src/b.ts", "const b = 2;");

		const docs = db
			.prepare("SELECT * FROM documents WHERE repo_id = ? ORDER BY file_path")
			.all(repo.id) as Record<string, unknown>[];
		expect(docs.length).toBe(2);
		expect(docs[0].file_path).toBe("src/a.ts");
	});

	test("get by path", () => {
		const repo = createRepo("doc", "path");
		createDocument(repo.id, "lib/util.ts");
		const doc = db
			.prepare("SELECT * FROM documents WHERE repo_id = ? AND file_path = ?")
			.get(repo.id, "lib/util.ts") as Record<string, unknown>;
		expect(doc).toBeDefined();
		expect(doc.language).toBe("typescript");
	});

	test("upsert on conflict updates content", () => {
		const repo = createRepo("doc", "upsert");
		createDocument(repo.id, "src/x.ts", "old content");
		db.prepare(
			`INSERT INTO documents (repo_id, file_path, language, content, content_hash)
			 VALUES (?, 'src/x.ts', 'typescript', 'new content', 'hash456')
			 ON CONFLICT(repo_id, file_path) DO UPDATE SET content = excluded.content, content_hash = excluded.content_hash`,
		).run(repo.id);
		const doc = db
			.prepare("SELECT content FROM documents WHERE repo_id = ? AND file_path = 'src/x.ts'")
			.get(repo.id) as { content: string };
		expect(doc.content).toBe("new content");
	});

	test("delete by paths", () => {
		const repo = createRepo("doc", "delpaths");
		createDocument(repo.id, "a.ts");
		createDocument(repo.id, "b.ts");
		createDocument(repo.id, "c.ts");
		db.prepare("DELETE FROM documents WHERE repo_id = ? AND file_path IN ('a.ts', 'b.ts')").run(
			repo.id,
		);
		const remaining = db.prepare("SELECT * FROM documents WHERE repo_id = ?").all(repo.id);
		expect(remaining.length).toBe(1);
	});
});

describe("jobs", () => {
	test("create and get", () => {
		const repo = createRepo("job", "test");
		const job = db
			.prepare("INSERT INTO jobs (type, repo_id, params) VALUES (?, ?, ?) RETURNING *")
			.get("full-generation", repo.id, null) as Record<string, unknown>;
		expect(job.id).toBeGreaterThan(0);
		expect(job.status).toBe("pending");
		expect(job.progress).toBe(0);
	});

	test("claim next job", () => {
		const repo = createRepo("job", "claim");
		db.prepare("INSERT INTO jobs (type, repo_id) VALUES (?, ?)").run("full-generation", repo.id);

		const claimed = db
			.prepare(
				`UPDATE jobs SET status = 'processing', started_at = datetime('now')
				 WHERE id = (
					SELECT id FROM jobs WHERE status = 'pending' AND repo_id = ? ORDER BY created_at LIMIT 1
				 )
				 RETURNING *`,
			)
			.get(repo.id) as Record<string, unknown>;
		expect(claimed).toBeDefined();
		expect(claimed.status).toBe("processing");
		expect(claimed.started_at).not.toBeNull();
	});

	test("update progress", () => {
		const repo = createRepo("job", "progress");
		const job = db
			.prepare("INSERT INTO jobs (type, repo_id) VALUES (?, ?) RETURNING *")
			.get("full-generation", repo.id) as Record<string, unknown>;
		db.prepare("UPDATE jobs SET progress = ?, progress_message = ? WHERE id = ?").run(
			50,
			"Halfway there",
			job.id,
		);
		const row = db
			.prepare("SELECT progress, progress_message FROM jobs WHERE id = ?")
			.get(job.id) as {
			progress: number;
			progress_message: string;
		};
		expect(row.progress).toBe(50);
		expect(row.progress_message).toBe("Halfway there");
	});

	test("complete job", () => {
		const repo = createRepo("job", "complete");
		const job = db
			.prepare("INSERT INTO jobs (type, repo_id) VALUES (?, ?) RETURNING *")
			.get("full-generation", repo.id) as Record<string, unknown>;
		db.prepare(
			"UPDATE jobs SET status = 'completed', progress = 100, completed_at = datetime('now') WHERE id = ?",
		).run(job.id);
		const row = db.prepare("SELECT status, progress FROM jobs WHERE id = ?").get(job.id) as {
			status: string;
			progress: number;
		};
		expect(row.status).toBe("completed");
		expect(row.progress).toBe(100);
	});

	test("fail job", () => {
		const repo = createRepo("job", "fail");
		const job = db
			.prepare("INSERT INTO jobs (type, repo_id) VALUES (?, ?) RETURNING *")
			.get("full-generation", repo.id) as Record<string, unknown>;
		db.prepare(
			"UPDATE jobs SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?",
		).run("Something went wrong", job.id);
		const row = db.prepare("SELECT status, error_message FROM jobs WHERE id = ?").get(job.id) as {
			status: string;
			error_message: string;
		};
		expect(row.status).toBe("failed");
		expect(row.error_message).toBe("Something went wrong");
	});

	test("reset processing jobs", () => {
		const repo = createRepo("job", "reset");
		db.prepare("INSERT INTO jobs (type, repo_id, status) VALUES (?, ?, 'processing')").run(
			"full-generation",
			repo.id,
		);
		const result = db
			.prepare(
				"UPDATE jobs SET status = 'pending', started_at = NULL WHERE status = 'processing' AND repo_id = ?",
			)
			.run(repo.id);
		expect(result.changes).toBeGreaterThan(0);
	});

	test("get active job for repo", () => {
		const repo = createRepo("job", "active");
		db.prepare("INSERT INTO jobs (type, repo_id, status) VALUES (?, ?, 'processing')").run(
			"full-generation",
			repo.id,
		);
		const job = db
			.prepare(
				"SELECT * FROM jobs WHERE repo_id = ? AND status IN ('pending', 'processing') ORDER BY created_at DESC LIMIT 1",
			)
			.get(repo.id) as Record<string, unknown>;
		expect(job).toBeDefined();
		expect(job.status).toBe("processing");
	});

	test("link job to wiki via wiki_id", () => {
		const repo = createRepo("job", "wikilink");
		const wiki = db
			.prepare(
				`INSERT INTO wikis (repo_id, title, description, structure, model) VALUES (?, ?, ?, ?, ?) RETURNING *`,
			)
			.get(repo.id, "Wiki", null, "{}", "claude-sonnet") as Record<string, unknown>;
		const job = db
			.prepare("INSERT INTO jobs (type, repo_id) VALUES (?, ?) RETURNING *")
			.get("full-generation", repo.id) as Record<string, unknown>;

		expect(job.wiki_id).toBeNull();

		db.prepare("UPDATE jobs SET wiki_id = ? WHERE id = ?").run(wiki.id, job.id);
		const updated = db.prepare("SELECT wiki_id FROM jobs WHERE id = ?").get(job.id) as {
			wiki_id: number;
		};
		expect(updated.wiki_id).toBe(wiki.id);
	});

	test("wiki_id set to null on wiki delete", () => {
		const repo = createRepo("job", "wikidel");
		const wiki = db
			.prepare(
				`INSERT INTO wikis (repo_id, title, description, structure, model) VALUES (?, ?, ?, ?, ?) RETURNING *`,
			)
			.get(repo.id, "Wiki", null, "{}", "claude-sonnet") as Record<string, unknown>;
		const job = db
			.prepare("INSERT INTO jobs (type, repo_id, wiki_id) VALUES (?, ?, ?) RETURNING *")
			.get("full-generation", repo.id, wiki.id) as Record<string, unknown>;

		expect(job.wiki_id).toBe(wiki.id);

		db.prepare("DELETE FROM wikis WHERE id = ?").run(wiki.id);
		const updated = db.prepare("SELECT wiki_id FROM jobs WHERE id = ?").get(job.id) as {
			wiki_id: number | null;
		};
		expect(updated.wiki_id).toBeNull();
	});
});

describe("wikis", () => {
	test("create wiki", () => {
		const repo = createRepo("wiki", "test");
		const wiki = db
			.prepare(
				`INSERT INTO wikis (repo_id, title, description, structure, model)
				 VALUES (?, ?, ?, ?, ?)
				 RETURNING *`,
			)
			.get(repo.id, "Test Wiki", "A test wiki", '{"sections":[]}', "claude-sonnet") as Record<
			string,
			unknown
		>;
		expect(wiki.id).toBeGreaterThan(0);
		expect(wiki.title).toBe("Test Wiki");
		expect(wiki.status).toBe("generating");
	});

	test("allows multiple wikis per repo (no unique constraint)", () => {
		const repo = createRepo("wiki", "multi");
		db.prepare(
			`INSERT INTO wikis (repo_id, title, description, structure, model) VALUES (?, ?, ?, ?, ?)`,
		).run(repo.id, "Wiki 1", null, "{}", "claude-sonnet");
		db.prepare(
			`INSERT INTO wikis (repo_id, title, description, structure, model) VALUES (?, ?, ?, ?, ?)`,
		).run(repo.id, "Wiki 2", null, "{}", "claude-sonnet");
		const wikis = db.prepare("SELECT * FROM wikis WHERE repo_id = ?").all(repo.id) as Record<
			string,
			unknown
		>[];
		expect(wikis.length).toBe(2);
	});

	test("get wiki by repo", () => {
		const repo = createRepo("wiki", "byrepo");
		db.prepare(
			`INSERT INTO wikis (repo_id, title, description, structure, model) VALUES (?, ?, ?, ?, ?)`,
		).run(repo.id, "Wiki", null, "{}", "claude-sonnet");
		const wiki = db.prepare("SELECT * FROM wikis WHERE repo_id = ?").get(repo.id) as Record<
			string,
			unknown
		>;
		expect(wiki).toBeDefined();
		expect(wiki.title).toBe("Wiki");
	});

	test("update wiki status", () => {
		const repo = createRepo("wiki", "update");
		const wiki = db
			.prepare(
				`INSERT INTO wikis (repo_id, title, description, structure, model) VALUES (?, ?, ?, ?, ?) RETURNING *`,
			)
			.get(repo.id, "Wiki", null, "{}", "claude-sonnet") as Record<string, unknown>;
		db.prepare("UPDATE wikis SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
			"completed",
			wiki.id,
		);
		const row = db.prepare("SELECT status FROM wikis WHERE id = ?").get(wiki.id) as {
			status: string;
		};
		expect(row.status).toBe("completed");
	});

	test("delete wiki cascades to pages", () => {
		const repo = createRepo("wiki", "delcascade");
		const wiki = db
			.prepare(
				`INSERT INTO wikis (repo_id, title, description, structure, model) VALUES (?, ?, ?, ?, ?) RETURNING *`,
			)
			.get(repo.id, "Wiki", null, "{}", "claude-sonnet") as Record<string, unknown>;
		db.prepare(
			`INSERT INTO wiki_pages (wiki_id, page_id, title, parent_id, sort_order) VALUES (?, ?, ?, ?, ?)`,
		).run(wiki.id, "p1", "Page 1", null, 0);
		db.prepare("DELETE FROM wikis WHERE id = ?").run(wiki.id);
		const pages = db.prepare("SELECT * FROM wiki_pages WHERE wiki_id = ?").all(wiki.id);
		expect(pages.length).toBe(0);
	});
});

describe("wiki_pages", () => {
	test("create page", () => {
		const repo = createRepo("wp", "test");
		const wiki = db
			.prepare(
				`INSERT INTO wikis (repo_id, title, description, structure, model) VALUES (?, ?, ?, ?, ?) RETURNING *`,
			)
			.get(repo.id, "Wiki", null, "{}", "claude-sonnet") as Record<string, unknown>;

		const page = db
			.prepare(
				`INSERT INTO wiki_pages (wiki_id, page_id, title, parent_id, sort_order, file_paths)
				 VALUES (?, ?, ?, ?, ?, ?)
				 RETURNING *`,
			)
			.get(wiki.id, "overview", "Overview", null, 0, '["src/index.ts"]') as Record<string, unknown>;
		expect(page.id).toBeGreaterThan(0);
		expect(page.status).toBe("pending");
	});

	test("get pages by wiki ordered by sort_order", () => {
		const repo = createRepo("wp", "list");
		const wiki = db
			.prepare(
				`INSERT INTO wikis (repo_id, title, description, structure, model) VALUES (?, ?, ?, ?, ?) RETURNING *`,
			)
			.get(repo.id, "Wiki", null, "{}", "claude-sonnet") as Record<string, unknown>;

		db.prepare(
			`INSERT INTO wiki_pages (wiki_id, page_id, title, parent_id, sort_order) VALUES (?, ?, ?, ?, ?)`,
		).run(wiki.id, "page-2", "Page 2", null, 1);
		db.prepare(
			`INSERT INTO wiki_pages (wiki_id, page_id, title, parent_id, sort_order) VALUES (?, ?, ?, ?, ?)`,
		).run(wiki.id, "page-1", "Page 1", null, 0);

		const pages = db
			.prepare("SELECT * FROM wiki_pages WHERE wiki_id = ? ORDER BY sort_order")
			.all(wiki.id) as Record<string, unknown>[];
		expect(pages.length).toBe(2);
		expect(pages[0].page_id).toBe("page-1");
		expect(pages[1].page_id).toBe("page-2");
	});

	test("get specific page by wiki_id and page_id", () => {
		const repo = createRepo("wp", "specific");
		const wiki = db
			.prepare(
				`INSERT INTO wikis (repo_id, title, description, structure, model) VALUES (?, ?, ?, ?, ?) RETURNING *`,
			)
			.get(repo.id, "Wiki", null, "{}", "claude-sonnet") as Record<string, unknown>;
		db.prepare(
			`INSERT INTO wiki_pages (wiki_id, page_id, title, parent_id, sort_order) VALUES (?, ?, ?, ?, ?)`,
		).run(wiki.id, "my-page", "My Page", null, 0);

		const page = db
			.prepare("SELECT * FROM wiki_pages WHERE wiki_id = ? AND page_id = ?")
			.get(wiki.id, "my-page") as Record<string, unknown>;
		expect(page).toBeDefined();
		expect(page.title).toBe("My Page");
	});

	test("update page content and status", () => {
		const repo = createRepo("wp", "update");
		const wiki = db
			.prepare(
				`INSERT INTO wikis (repo_id, title, description, structure, model) VALUES (?, ?, ?, ?, ?) RETURNING *`,
			)
			.get(repo.id, "Wiki", null, "{}", "claude-sonnet") as Record<string, unknown>;

		const page = db
			.prepare(
				`INSERT INTO wiki_pages (wiki_id, page_id, title, parent_id, sort_order) VALUES (?, ?, ?, ?, ?) RETURNING *`,
			)
			.get(wiki.id, "page-1", "Page 1", null, 0) as Record<string, unknown>;

		db.prepare(
			"UPDATE wiki_pages SET content = ?, diagrams = ?, status = ?, updated_at = datetime('now') WHERE id = ?",
		).run("# Hello World", '["diagram1"]', "completed", page.id);

		const row = db
			.prepare("SELECT content, diagrams, status FROM wiki_pages WHERE id = ?")
			.get(page.id) as Record<string, unknown>;
		expect(row.content).toBe("# Hello World");
		expect(row.diagrams).toBe('["diagram1"]');
		expect(row.status).toBe("completed");
	});

	test("upsert on conflict updates page", () => {
		const repo = createRepo("wp", "upsert");
		const wiki = db
			.prepare(
				`INSERT INTO wikis (repo_id, title, description, structure, model) VALUES (?, ?, ?, ?, ?) RETURNING *`,
			)
			.get(repo.id, "Wiki", null, "{}", "claude-sonnet") as Record<string, unknown>;

		db.prepare(
			`INSERT INTO wiki_pages (wiki_id, page_id, title, parent_id, sort_order)
			 VALUES (?, ?, ?, ?, ?)`,
		).run(wiki.id, "dup-page", "Original Title", null, 0);

		db.prepare(
			`INSERT INTO wiki_pages (wiki_id, page_id, title, parent_id, sort_order, file_paths)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(wiki_id, page_id) DO UPDATE SET
				title = excluded.title,
				sort_order = excluded.sort_order,
				file_paths = excluded.file_paths,
				updated_at = datetime('now')`,
		).run(wiki.id, "dup-page", "Updated Title", null, 5, '["new.ts"]');

		const row = db
			.prepare(
				"SELECT title, sort_order, file_paths FROM wiki_pages WHERE wiki_id = ? AND page_id = ?",
			)
			.get(wiki.id, "dup-page") as { title: string; sort_order: number; file_paths: string };
		expect(row.title).toBe("Updated Title");
		expect(row.sort_order).toBe(5);
		expect(row.file_paths).toBe('["new.ts"]');
	});

	test("page with parent_id references section", () => {
		const repo = createRepo("wp", "parent");
		const wiki = db
			.prepare(
				`INSERT INTO wikis (repo_id, title, description, structure, model) VALUES (?, ?, ?, ?, ?) RETURNING *`,
			)
			.get(repo.id, "Wiki", null, "{}", "claude-sonnet") as Record<string, unknown>;

		db.prepare(
			`INSERT INTO wiki_pages (wiki_id, page_id, title, parent_id, sort_order) VALUES (?, ?, ?, ?, ?)`,
		).run(wiki.id, "child-page", "Child Page", "parent-section", 0);

		const page = db
			.prepare("SELECT parent_id FROM wiki_pages WHERE wiki_id = ? AND page_id = ?")
			.get(wiki.id, "child-page") as { parent_id: string };
		expect(page.parent_id).toBe("parent-section");
	});
});
