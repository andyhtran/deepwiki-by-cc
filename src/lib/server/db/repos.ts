import type { Repo } from "$lib/types.js";
import { getDb } from "./index.js";

export function createRepo(data: {
	owner: string;
	name: string;
	url: string;
	default_branch?: string;
}): Repo {
	const db = getDb();
	const fullName = `${data.owner}/${data.name}`;
	const stmt = db.prepare(`
		INSERT INTO repos (owner, name, full_name, url, default_branch)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(full_name) DO UPDATE SET
			url = excluded.url,
			updated_at = datetime('now')
		RETURNING *
	`);
	return stmt.get(data.owner, data.name, fullName, data.url, data.default_branch || "main") as Repo;
}

export function getRepo(id: number): Repo | undefined {
	const db = getDb();
	return db.prepare("SELECT * FROM repos WHERE id = ?").get(id) as Repo | undefined;
}

export function getRepoByFullName(fullName: string): Repo | undefined {
	const db = getDb();
	return db.prepare("SELECT * FROM repos WHERE full_name = ?").get(fullName) as Repo | undefined;
}

export function updateRepo(id: number, data: Partial<Repo>): void {
	const db = getDb();
	const fields: string[] = [];
	const values: unknown[] = [];

	for (const [key, value] of Object.entries(data)) {
		if (key === "id" || key === "created_at") continue;
		fields.push(`${key} = ?`);
		values.push(value);
	}

	if (fields.length === 0) return;

	fields.push("updated_at = datetime('now')");
	values.push(id);

	db.prepare(`UPDATE repos SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteRepo(id: number): void {
	const db = getDb();
	db.prepare("DELETE FROM repos WHERE id = ?").run(id);
}
