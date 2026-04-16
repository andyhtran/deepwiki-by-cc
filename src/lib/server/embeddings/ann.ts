import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { getChunkEmbeddingsForRepo } from "../db/embeddings.js";
import { log } from "../logger.js";
import { createEndpointFingerprint } from "./client.js";
import { cosineSimilarity } from "./retrieval.js";

export interface AnnSearchResult {
	chunkId: number;
	filePath: string;
	chunkSeq: number;
	chunkText: string;
	offsetStart: number;
	offsetEnd: number;
	score: number;
}

export interface AnnIndex {
	repoId: number;
	embeddingModel: string;
	endpointFingerprint: string;
	chunkCount: number;
	builtAt: string;
}

/**
 * Returns the directory for storing ANN index files, scoped by repo/model/endpoint.
 */
function indexDir(repoId: number, embeddingModel: string, endpointFingerprint: string): string {
	const fp = endpointFingerprint.slice(0, 16);
	return join(config.dataDir, "ann", `repo-${repoId}`, `${embeddingModel}-${fp}`);
}

function indexMetaPath(dir: string): string {
	return join(dir, "index.json");
}

/**
 * Returns metadata about the current ANN index for a repo, or null if no
 * index exists.
 */
export function getAnnIndexInfo(
	repoId: number,
	embeddingModel: string,
	baseUrl: string,
): AnnIndex | null {
	const fp = createEndpointFingerprint(baseUrl);
	const metaPath = indexMetaPath(indexDir(repoId, embeddingModel, fp));
	if (!existsSync(metaPath)) return null;
	try {
		return JSON.parse(readFileSync(metaPath, "utf-8")) as AnnIndex;
	} catch {
		return null;
	}
}

/**
 * Builds (or rebuilds) the ANN index for a repo.
 * Currently stores a simple JSON manifest; the actual search uses exact cosine
 * scan from the database. This structure is forward-compatible — a future
 * upgrade can write an HNSW index file here and the search function can
 * load it instead of hitting the DB.
 */
export function buildAnnIndex(repoId: number, embeddingModel: string, baseUrl: string): AnnIndex {
	const fp = createEndpointFingerprint(baseUrl);
	const dir = indexDir(repoId, embeddingModel, fp);
	mkdirSync(dir, { recursive: true });

	const chunks = getChunkEmbeddingsForRepo(repoId, embeddingModel, fp);

	const meta: AnnIndex = {
		repoId,
		embeddingModel,
		endpointFingerprint: fp,
		chunkCount: chunks.length,
		builtAt: new Date().toISOString(),
	};

	writeFileSync(indexMetaPath(dir), JSON.stringify(meta, null, 2));

	log.retrieval.info(
		{ repoId, model: embeddingModel, chunks: chunks.length },
		"ANN index built (exact-scan backend)",
	);

	return meta;
}

/**
 * Searches the ANN index for the most similar chunks to the query vector.
 * Falls back to exact cosine scan over all repo embeddings in the database.
 *
 * This is the integration point for a future native ANN backend (HNSW, etc.).
 * The interface is stable — only the internal implementation changes.
 */
export function searchAnn(params: {
	repoId: number;
	embeddingModel: string;
	endpointFingerprint: string;
	queryVector: number[];
	topK: number;
}): AnnSearchResult[] {
	// Exact cosine scan fallback — works for any repo size, just slower at scale
	const candidates = getChunkEmbeddingsForRepo(
		params.repoId,
		params.embeddingModel,
		params.endpointFingerprint,
	);

	if (candidates.length === 0) return [];

	const scored = candidates
		.map((c) => ({
			chunkId: c.chunkId,
			filePath: c.filePath,
			chunkSeq: c.chunkSeq,
			chunkText: c.chunkText,
			offsetStart: c.offsetStart,
			offsetEnd: c.offsetEnd,
			score: cosineSimilarity(params.queryVector, c.embedding),
		}))
		.filter((item) => Number.isFinite(item.score))
		.sort((a, b) => b.score - a.score);

	return scored.slice(0, params.topK);
}
