import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
	if (_db) return _db;

	const dbPath = join(config.dataDir, "deepwiki.db");
	mkdirSync(dirname(dbPath), { recursive: true });

	const db = new Database(dbPath);

	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");

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

function runMigrations(db: Database.Database): void {
	// Migration: add token_count column to document_chunks (added for token-aware chunking)
	const chunkCols = db.pragma("table_info(document_chunks)") as { name: string }[];
	if (!chunkCols.some((c) => c.name === "token_count")) {
		db.exec("ALTER TABLE document_chunks ADD COLUMN token_count INTEGER");
	}

	// Migration: add version column to wikis and backfill with per-repo sequence numbers
	const wikiCols = db.pragma("table_info(wikis)") as { name: string }[];
	const wikiColNames = new Set(wikiCols.map((c) => c.name));
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

	// Migration: add embedding snapshot columns to wikis
	if (!wikiColNames.has("embedding_enabled")) {
		db.exec("ALTER TABLE wikis ADD COLUMN embedding_enabled INTEGER NOT NULL DEFAULT 0");
	}
	if (!wikiColNames.has("embedding_model")) {
		db.exec("ALTER TABLE wikis ADD COLUMN embedding_model TEXT");
	}
	if (!wikiColNames.has("embedding_endpoint_fingerprint")) {
		db.exec("ALTER TABLE wikis ADD COLUMN embedding_endpoint_fingerprint TEXT");
	}
}
