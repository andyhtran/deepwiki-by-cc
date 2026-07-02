import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type Database from "better-sqlite3";
import { config } from "../config.js";

let _db: Database.Database | null = null;

// better-sqlite3 is a V8-API native module that Bun cannot dlopen
// (oven-sh/bun#4290), so under Bun we substitute bun:sqlite. The two drivers
// are call-compatible for everything this codebase uses (prepare/get/all/run,
// exec, transaction), which is why the rest of the db layer can stay typed
// against better-sqlite3. The createRequire indirection keeps Vite's Node
// build from trying to resolve "bun:sqlite" at bundle time.
function openDatabase(dbPath: string): Database.Database {
	const require_ = createRequire(import.meta.url);
	if (process.versions.bun) {
		const { Database: BunDatabase } = require_("bun:sqlite") as {
			Database: new (path: string) => unknown;
		};
		return new BunDatabase(dbPath) as Database.Database;
	}
	const BetterSqlite3 = require_("better-sqlite3") as typeof import("better-sqlite3");
	return new BetterSqlite3(dbPath);
}

export function getDb(): Database.Database {
	if (_db) return _db;

	const dbPath = join(config.dataDir, "deepwiki.db");
	mkdirSync(dirname(dbPath), { recursive: true });

	const db = openDatabase(dbPath);

	// exec-based pragmas work on both drivers; .pragma() is better-sqlite3-only.
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA foreign_keys = ON");

	const schemaPath = join(dirname(new URL(import.meta.url).pathname), "schema.sql");
	const schema = readFileSync(schemaPath, "utf-8");

	const statements = schema
		.split(";")
		.map((s) => s.trim())
		.filter((s) => s.length > 0 && !s.startsWith("PRAGMA"));

	for (const stmt of statements) {
		db.exec(`${stmt};`);
	}

	// Incremental migrations for columns added after initial schema
	runMigrations(db);

	_db = db;
	return db;
}

function tableColumns(db: Database.Database, table: string): Set<string> {
	const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
	return new Set(cols.map((c) => c.name));
}

function runMigrations(db: Database.Database): void {
	// Migration: add version column to wikis and backfill with per-repo sequence
	// numbers. Older DBs may carry embedding_*/chunk tables from the removed
	// embeddings subsystem — those are simply left unused.
	const wikiColNames = tableColumns(db, "wikis");
	if (!wikiColNames.has("version")) {
		db.exec("ALTER TABLE wikis ADD COLUMN version INTEGER");
		db.exec(`
			UPDATE wikis SET version = (
				SELECT rn FROM (
					SELECT id, ROW_NUMBER() OVER (PARTITION BY repo_id ORDER BY created_at ASC) AS rn
					FROM wikis
				) ranked WHERE ranked.id = wikis.id
			)
		`);
	}

	// Migration: legacy documents tables stored full file content for the
	// removed retrieval subsystem. Rebuild slim, preserving path + hash so
	// link-policy file lists and sync dedupe keep working for existing wikis.
	if (tableColumns(db, "documents").has("content")) {
		db.exec(`
			CREATE TABLE documents_slim (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
				file_path TEXT NOT NULL,
				content_hash TEXT NOT NULL,
				created_at TEXT DEFAULT (datetime('now')),
				UNIQUE(repo_id, file_path)
			);
			INSERT INTO documents_slim (id, repo_id, file_path, content_hash, created_at)
				SELECT id, repo_id, file_path, content_hash, created_at FROM documents;
			DROP TABLE documents;
			ALTER TABLE documents_slim RENAME TO documents;
			CREATE INDEX IF NOT EXISTS idx_documents_repo ON documents(repo_id);
		`);
		// Dropped content is the bulk of the DB — reclaim the pages now rather
		// than leaving them as free-list slack. One-time cost at startup.
		db.exec("VACUUM");
	}
}
