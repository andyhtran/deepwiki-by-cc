import { getDb } from "./index.js";

// Documents are a per-repo index of scanned file paths + content hashes.
// Page agents read source from the checkout on disk, so file CONTENT is
// deliberately not persisted — the index only powers link-policy file lists,
// changed-file matching on sync, and skip-unchanged dedupe on regeneration.
export function insertDocument(data: {
	repo_id: number;
	file_path: string;
	content_hash: string;
}): void {
	const db = getDb();
	db.prepare(`
		INSERT INTO documents (repo_id, file_path, content_hash)
		VALUES (?, ?, ?)
		ON CONFLICT(repo_id, file_path) DO UPDATE SET
			content_hash = excluded.content_hash
	`).run(data.repo_id, data.file_path, data.content_hash);
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
