import { getDb } from "./index.js";

export function insertDocument(data: {
	repo_id: number;
	file_path: string;
	language: string | null;
	content: string;
	content_hash: string;
}): void {
	const db = getDb();
	db.prepare(`
		INSERT INTO documents (repo_id, file_path, language, content, content_hash)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(repo_id, file_path) DO UPDATE SET
			language = excluded.language,
			content = excluded.content,
			content_hash = excluded.content_hash
	`).run(data.repo_id, data.file_path, data.language, data.content, data.content_hash);
}

export function deleteDocumentsByRepo(repoId: number): void {
	const db = getDb();
	db.prepare("DELETE FROM documents WHERE repo_id = ?").run(repoId);
}

export function deleteDocumentsByPaths(repoId: number, paths: string[]): void {
	const db = getDb();
	const placeholders = paths.map(() => "?").join(",");
	db.prepare(`DELETE FROM documents WHERE repo_id = ? AND file_path IN (${placeholders})`).run(
		repoId,
		...paths,
	);
}

export function getDocumentsWithHashByRepo(
	repoId: number,
): Map<string, { id: number; content_hash: string }> {
	const db = getDb();
	const rows = db
		.prepare("SELECT id, file_path, content_hash FROM documents WHERE repo_id = ?")
		.all(repoId) as { id: number; file_path: string; content_hash: string }[];
	return new Map(rows.map((r) => [r.file_path, { id: r.id, content_hash: r.content_hash }]));
}

export function getRepoFilePaths(repoId: number): string[] {
	const db = getDb();
	const rows = db.prepare("SELECT file_path FROM documents WHERE repo_id = ?").all(repoId) as {
		file_path: string;
	}[];
	return rows.map((r) => r.file_path);
}
