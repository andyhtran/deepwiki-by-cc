import { getDb } from "./index.js";

export function setSetting(key: string, value: string): void {
	const db = getDb();
	db.prepare(
		`INSERT INTO settings (key, value, updated_at)
		 VALUES (?, ?, datetime('now'))
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
	).run(key, value);
}

export function getAllSettings(): Record<string, string> {
	const db = getDb();
	const rows = db.prepare("SELECT key, value FROM settings").all() as {
		key: string;
		value: string;
	}[];
	const result: Record<string, string> = {};
	for (const row of rows) {
		result[row.key] = row.value;
	}
	return result;
}
