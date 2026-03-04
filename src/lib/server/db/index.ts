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

	_db = db;
	return db;
}
