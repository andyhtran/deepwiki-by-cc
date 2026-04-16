import { getDb } from "./index.js";

export interface DocumentChunkRecord {
	id: number;
	repo_id: number;
	file_path: string;
	content_hash: string;
	chunk_seq: number;
	chunk_text: string;
	offset_start: number;
	offset_end: number;
}

export interface ChunkEmbeddingRecord {
	chunkId: number;
	repoId: number;
	filePath: string;
	contentHash: string;
	chunkSeq: number;
	chunkText: string;
	offsetStart: number;
	offsetEnd: number;
	embedding: number[];
	embeddingModel: string;
	endpointFingerprint: string;
}

export interface ChunkWithEmbeddingInput {
	chunkSeq: number;
	chunkText: string;
	offsetStart: number;
	offsetEnd: number;
	tokenCount?: number;
	embedding: number[];
}

export function getEmbeddedHashesByFile(
	repoId: number,
	filePaths: string[],
	embeddingModel: string,
	endpointFingerprint: string,
): Map<string, Set<string>> {
	if (filePaths.length === 0) return new Map();

	const db = getDb();
	const placeholders = filePaths.map(() => "?").join(",");
	const rows = db
		.prepare(
			`SELECT c.file_path, c.content_hash
			 FROM document_chunks c
			 INNER JOIN chunk_embeddings e ON e.chunk_id = c.id
			 WHERE c.repo_id = ?
				AND c.file_path IN (${placeholders})
				AND e.embedding_model = ?
				AND e.endpoint_fingerprint = ?
			 GROUP BY c.file_path, c.content_hash`,
		)
		.all(repoId, ...filePaths, embeddingModel, endpointFingerprint) as {
		file_path: string;
		content_hash: string;
	}[];

	const byPath = new Map<string, Set<string>>();
	for (const row of rows) {
		const set = byPath.get(row.file_path) ?? new Set<string>();
		set.add(row.content_hash);
		byPath.set(row.file_path, set);
	}
	return byPath;
}

export function deleteEmbeddingDataByPaths(repoId: number, filePaths: string[]): void {
	if (filePaths.length === 0) return;

	const db = getDb();
	const placeholders = filePaths.map(() => "?").join(",");
	db.prepare(
		`DELETE FROM document_chunks WHERE repo_id = ? AND file_path IN (${placeholders})`,
	).run(repoId, ...filePaths);
}

export function replaceFileEmbeddings(data: {
	repoId: number;
	filePath: string;
	contentHash: string;
	embeddingModel: string;
	endpointFingerprint: string;
	chunks: ChunkWithEmbeddingInput[];
}): void {
	const db = getDb();

	// We treat a file embedding refresh as an atomic unit so retrieval never sees partial vectors.
	const tx = db.transaction(
		(payload: {
			repoId: number;
			filePath: string;
			contentHash: string;
			embeddingModel: string;
			endpointFingerprint: string;
			chunks: ChunkWithEmbeddingInput[];
		}) => {
			db.prepare("DELETE FROM document_chunks WHERE repo_id = ? AND file_path = ?").run(
				payload.repoId,
				payload.filePath,
			);

			const chunkStmt = db.prepare(
				`INSERT INTO document_chunks
					(repo_id, file_path, content_hash, chunk_seq, chunk_text, offset_start, offset_end, token_count, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
				 RETURNING id`,
			);
			const embeddingStmt = db.prepare(
				`INSERT INTO chunk_embeddings
					(chunk_id, repo_id, file_path, content_hash, embedding, embedding_dim, embedding_model, endpoint_fingerprint, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
			);

			for (const chunk of payload.chunks) {
				const inserted = chunkStmt.get(
					payload.repoId,
					payload.filePath,
					payload.contentHash,
					chunk.chunkSeq,
					chunk.chunkText,
					chunk.offsetStart,
					chunk.offsetEnd,
					chunk.tokenCount ?? null,
				) as { id: number };

				embeddingStmt.run(
					inserted.id,
					payload.repoId,
					payload.filePath,
					payload.contentHash,
					JSON.stringify(chunk.embedding),
					chunk.embedding.length,
					payload.embeddingModel,
					payload.endpointFingerprint,
				);
			}
		},
	);

	tx(data);
}

/**
 * Retrieves all chunk embeddings for a repo, not constrained to specific files.
 * Used by global/hybrid retrieval to search the entire codebase.
 */
export function getChunkEmbeddingsForRepo(
	repoId: number,
	embeddingModel: string,
	endpointFingerprint: string,
): ChunkEmbeddingRecord[] {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT
				c.id AS chunk_id,
				c.repo_id,
				c.file_path,
				c.content_hash,
				c.chunk_seq,
				c.chunk_text,
				c.offset_start,
				c.offset_end,
				e.embedding,
				e.embedding_model,
				e.endpoint_fingerprint
			 FROM document_chunks c
			 INNER JOIN chunk_embeddings e ON e.chunk_id = c.id
			 WHERE c.repo_id = ?
				AND e.embedding_model = ?
				AND e.endpoint_fingerprint = ?
			 ORDER BY c.file_path ASC, c.chunk_seq ASC`,
		)
		.all(repoId, embeddingModel, endpointFingerprint) as {
		chunk_id: number;
		repo_id: number;
		file_path: string;
		content_hash: string;
		chunk_seq: number;
		chunk_text: string;
		offset_start: number;
		offset_end: number;
		embedding: string;
		embedding_model: string;
		endpoint_fingerprint: string;
	}[];

	const parsed: ChunkEmbeddingRecord[] = [];
	for (const row of rows) {
		try {
			const embedding = JSON.parse(row.embedding) as number[];
			if (!Array.isArray(embedding) || embedding.some((v) => typeof v !== "number")) {
				continue;
			}
			parsed.push({
				chunkId: row.chunk_id,
				repoId: row.repo_id,
				filePath: row.file_path,
				contentHash: row.content_hash,
				chunkSeq: row.chunk_seq,
				chunkText: row.chunk_text,
				offsetStart: row.offset_start,
				offsetEnd: row.offset_end,
				embedding,
				embeddingModel: row.embedding_model,
				endpointFingerprint: row.endpoint_fingerprint,
			});
		} catch {}
	}

	return parsed;
}

export function getChunkEmbeddingsForFiles(
	repoId: number,
	filePaths: string[],
	embeddingModel: string,
	endpointFingerprint: string,
): ChunkEmbeddingRecord[] {
	if (filePaths.length === 0) return [];

	const db = getDb();
	const placeholders = filePaths.map(() => "?").join(",");
	const rows = db
		.prepare(
			`SELECT
				c.id AS chunk_id,
				c.repo_id,
				c.file_path,
				c.content_hash,
				c.chunk_seq,
				c.chunk_text,
				c.offset_start,
				c.offset_end,
				e.embedding,
				e.embedding_model,
				e.endpoint_fingerprint
			 FROM document_chunks c
			 INNER JOIN chunk_embeddings e ON e.chunk_id = c.id
			 WHERE c.repo_id = ?
				AND c.file_path IN (${placeholders})
				AND e.embedding_model = ?
				AND e.endpoint_fingerprint = ?
			 ORDER BY c.file_path ASC, c.chunk_seq ASC`,
		)
		.all(repoId, ...filePaths, embeddingModel, endpointFingerprint) as {
		chunk_id: number;
		repo_id: number;
		file_path: string;
		content_hash: string;
		chunk_seq: number;
		chunk_text: string;
		offset_start: number;
		offset_end: number;
		embedding: string;
		embedding_model: string;
		endpoint_fingerprint: string;
	}[];

	const parsed: ChunkEmbeddingRecord[] = [];
	for (const row of rows) {
		try {
			const embedding = JSON.parse(row.embedding) as number[];
			if (!Array.isArray(embedding) || embedding.some((v) => typeof v !== "number")) {
				continue;
			}
			parsed.push({
				chunkId: row.chunk_id,
				repoId: row.repo_id,
				filePath: row.file_path,
				contentHash: row.content_hash,
				chunkSeq: row.chunk_seq,
				chunkText: row.chunk_text,
				offsetStart: row.offset_start,
				offsetEnd: row.offset_end,
				embedding,
				embeddingModel: row.embedding_model,
				endpointFingerprint: row.endpoint_fingerprint,
			});
		} catch {}
	}

	return parsed;
}
