import type { Wiki, WikiPage } from "$lib/types.js";
import { getDb } from "./index.js";

export function createWiki(data: {
	repo_id: number | null;
	title: string;
	description: string | null;
	structure: string;
	model: string;
	source_type?: string;
	generation_duration_ms?: number | null;
}): Wiki {
	const db = getDb();
	const stmt = db.prepare(`
		INSERT INTO wikis (repo_id, title, description, structure, model, source_type, generation_duration_ms)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		RETURNING *
	`);
	return stmt.get(
		data.repo_id,
		data.title,
		data.description,
		data.structure,
		data.model,
		data.source_type ?? "github",
		data.generation_duration_ms ?? null,
	) as Wiki;
}

export function getWikiById(id: number): Wiki | undefined {
	const db = getDb();
	return db.prepare("SELECT * FROM wikis WHERE id = ?").get(id) as Wiki | undefined;
}

export function getWikiByRepo(repoId: number): Wiki | undefined {
	const db = getDb();
	return db
		.prepare("SELECT * FROM wikis WHERE repo_id = ? ORDER BY created_at DESC LIMIT 1")
		.get(repoId) as Wiki | undefined;
}

export function getWikiByOwnerRepo(owner: string, repo: string): Wiki | undefined {
	const db = getDb();
	return db
		.prepare(
			`SELECT w.* FROM wikis w
			 INNER JOIN repos r ON r.id = w.repo_id
			 WHERE r.owner = ? AND r.name = ?
			 ORDER BY w.created_at DESC LIMIT 1`,
		)
		.get(owner, repo) as Wiki | undefined;
}

export function getWikisByOwnerRepo(
	owner: string,
	repo: string,
): (Wiki & { page_count: number })[] {
	const db = getDb();
	return db
		.prepare(
			`SELECT w.*,
				(SELECT COUNT(*) FROM wiki_pages wp WHERE wp.wiki_id = w.id) as page_count
			 FROM wikis w
			 INNER JOIN repos r ON r.id = w.repo_id
			 WHERE r.owner = ? AND r.name = ?
			 ORDER BY w.created_at DESC`,
		)
		.all(owner, repo) as (Wiki & { page_count: number })[];
}

interface WikiListItem extends Wiki {
	owner: string | null;
	repo_name: string | null;
	page_count: number;
	total_tokens: number | null;
	total_cost: number | null;
}

export function listWikis(): WikiListItem[] {
	const db = getDb();
	return db
		.prepare(
			`SELECT w.*, r.owner, r.name as repo_name,
				(SELECT COUNT(*) FROM wiki_pages wp WHERE wp.wiki_id = w.id) as page_count,
				j.total_prompt_tokens + j.total_completion_tokens as total_tokens,
				j.total_cost
			 FROM wikis w
			 LEFT JOIN repos r ON r.id = w.repo_id
			 LEFT JOIN jobs j ON j.wiki_id = w.id AND j.status = 'completed'
			 ORDER BY w.updated_at DESC`,
		)
		.all() as WikiListItem[];
}

export function updateWiki(
	id: number,
	data: Partial<Pick<Wiki, "status" | "structure" | "generation_duration_ms">>,
): void {
	const db = getDb();
	const fields: string[] = [];
	const values: unknown[] = [];

	for (const [key, value] of Object.entries(data)) {
		fields.push(`${key} = ?`);
		values.push(value);
	}

	if (fields.length === 0) return;
	fields.push("updated_at = datetime('now')");
	values.push(id);

	db.prepare(`UPDATE wikis SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteWikiById(id: number): void {
	const db = getDb();
	db.prepare("DELETE FROM wikis WHERE id = ?").run(id);
}

export function createWikiPage(data: {
	wiki_id: number;
	page_id: string;
	title: string;
	parent_id: string | null;
	sort_order: number;
	file_paths: string | null;
	content?: string | null;
	status?: string;
}): WikiPage {
	const db = getDb();
	const stmt = db.prepare(`
		INSERT INTO wiki_pages (wiki_id, page_id, title, parent_id, sort_order, file_paths, content, status)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(wiki_id, page_id) DO UPDATE SET
			title = excluded.title,
			parent_id = excluded.parent_id,
			sort_order = excluded.sort_order,
			file_paths = excluded.file_paths,
			content = COALESCE(excluded.content, wiki_pages.content),
			status = COALESCE(excluded.status, wiki_pages.status),
			updated_at = datetime('now')
		RETURNING *
	`);
	return stmt.get(
		data.wiki_id,
		data.page_id,
		data.title,
		data.parent_id,
		data.sort_order,
		data.file_paths,
		data.content ?? null,
		data.status ?? "pending",
	) as WikiPage;
}

export function getWikiPages(wikiId: number): WikiPage[] {
	const db = getDb();
	return db
		.prepare("SELECT * FROM wiki_pages WHERE wiki_id = ? ORDER BY sort_order")
		.all(wikiId) as WikiPage[];
}

export function updateWikiPage(
	id: number,
	data: Partial<
		Pick<
			WikiPage,
			| "content"
			| "diagrams"
			| "status"
			| "error_message"
			| "prompt_tokens"
			| "completion_tokens"
			| "model"
			| "generation_time_ms"
		>
	>,
): void {
	const db = getDb();
	const fields: string[] = [];
	const values: unknown[] = [];

	for (const [key, value] of Object.entries(data)) {
		fields.push(`${key} = ?`);
		values.push(value);
	}

	if (fields.length === 0) return;
	fields.push("updated_at = datetime('now')");
	values.push(id);

	db.prepare(`UPDATE wiki_pages SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}
