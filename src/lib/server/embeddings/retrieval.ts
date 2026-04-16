import type { EffectiveEmbeddingConfig, WeaknessThresholds } from "../config.js";
import { getChunkEmbeddingsForFiles, getChunkEmbeddingsForRepo } from "../db/embeddings.js";
import { createEmbeddings, createEndpointFingerprint } from "./client.js";

export interface RetrievedChunk {
	filePath: string;
	chunkSeq: number;
	chunkText: string;
	offsetStart: number;
	offsetEnd: number;
	score: number;
}

export interface RetrievalMetadata {
	chunkCount: number;
	contextChars: number;
	topScore: number;
	meanScore: number;
	scoreGap: number;
	uniqueFiles: number;
}

export interface RetrievalResult {
	chunks: RetrievedChunk[];
	metadata: RetrievalMetadata;
}

export function computeRetrievalMetadata(chunks: RetrievedChunk[]): RetrievalMetadata {
	if (chunks.length === 0) {
		return {
			chunkCount: 0,
			contextChars: 0,
			topScore: 0,
			meanScore: 0,
			scoreGap: 0,
			uniqueFiles: 0,
		};
	}
	const scores = chunks.map((c) => c.score);
	const topScore = scores[0];
	const meanScore = scores.reduce((a, b) => a + b, 0) / scores.length;
	// Gap between best and second-best score — flat gap means no single strong match
	const scoreGap = scores.length >= 2 ? scores[0] - scores[1] : scores[0];
	const contextChars = chunks.reduce((sum, c) => sum + c.chunkText.length, 0);
	const uniqueFiles = new Set(chunks.map((c) => c.filePath)).size;
	return { chunkCount: chunks.length, contextChars, topScore, meanScore, scoreGap, uniqueFiles };
}

export function isRetrievalWeak(
	metadata: RetrievalMetadata,
	thresholds: WeaknessThresholds,
): { weak: boolean; reasons: string[] } {
	const reasons: string[] = [];
	if (metadata.chunkCount < thresholds.minChunks) {
		reasons.push(`chunkCount ${metadata.chunkCount} < ${thresholds.minChunks}`);
	}
	if (metadata.contextChars < thresholds.minContextChars) {
		reasons.push(`contextChars ${metadata.contextChars} < ${thresholds.minContextChars}`);
	}
	if (metadata.topScore < thresholds.minTopScore) {
		reasons.push(`topScore ${metadata.topScore.toFixed(4)} < ${thresholds.minTopScore}`);
	}
	if (metadata.scoreGap < thresholds.minScoreGap) {
		reasons.push(`scoreGap ${metadata.scoreGap.toFixed(4)} < ${thresholds.minScoreGap}`);
	}
	return { weak: reasons.length > 0, reasons };
}

export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

	let dot = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	if (normA === 0 || normB === 0) return 0;
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function clampChunkText(text: string, remainingChars: number): string {
	if (text.length <= remainingChars) return text;
	if (remainingChars <= 0) return "";
	return `${text.slice(0, remainingChars)}\n... (chunk truncated)`;
}

export async function retrieveRelevantChunks(params: {
	repoId: number;
	filePaths: string[];
	queryText: string;
	embeddingConfig: EffectiveEmbeddingConfig;
}): Promise<RetrievedChunk[]> {
	if (!params.embeddingConfig.enabled) return [];
	if (params.filePaths.length === 0) return [];
	if (params.queryText.trim().length === 0) return [];

	const endpointFingerprint = createEndpointFingerprint(params.embeddingConfig.baseUrl);
	const candidates = getChunkEmbeddingsForFiles(
		params.repoId,
		params.filePaths,
		params.embeddingConfig.model,
		endpointFingerprint,
	);
	if (candidates.length === 0) return [];

	const { embeddings } = await createEmbeddings([params.queryText], {
		baseUrl: params.embeddingConfig.baseUrl,
		apiKey: params.embeddingConfig.apiKey,
		model: params.embeddingConfig.model,
		timeoutMs: params.embeddingConfig.timeoutMs,
	});
	const query = embeddings[0];

	const scored = candidates
		.map((candidate) => ({
			filePath: candidate.filePath,
			chunkSeq: candidate.chunkSeq,
			chunkText: candidate.chunkText,
			offsetStart: candidate.offsetStart,
			offsetEnd: candidate.offsetEnd,
			score: cosineSimilarity(query, candidate.embedding),
		}))
		.filter((item) => Number.isFinite(item.score))
		.sort((a, b) => b.score - a.score);

	const top = scored.slice(0, params.embeddingConfig.topK);
	const selected: RetrievedChunk[] = [];
	let usedChars = 0;

	for (const chunk of top) {
		const remaining = params.embeddingConfig.maxContextChars - usedChars;
		if (remaining <= 0) break;

		const text = clampChunkText(chunk.chunkText, remaining);
		if (text.length === 0) continue;
		selected.push({
			filePath: chunk.filePath,
			chunkSeq: chunk.chunkSeq,
			chunkText: text,
			offsetStart: chunk.offsetStart,
			offsetEnd: chunk.offsetEnd,
			score: chunk.score,
		});
		usedChars += text.length;
	}

	return selected;
}

/**
 * Global retrieval: searches ALL chunks in a repo, not limited to specific files.
 * Reuses the same query embedding if provided (avoids re-embedding the same query).
 */
export async function retrieveGlobalChunks(params: {
	repoId: number;
	queryText: string;
	queryEmbedding?: number[];
	embeddingConfig: EffectiveEmbeddingConfig;
	topK: number;
	maxContextChars: number;
}): Promise<RetrievedChunk[]> {
	if (!params.embeddingConfig.enabled) return [];
	if (params.queryText.trim().length === 0) return [];

	const endpointFingerprint = createEndpointFingerprint(params.embeddingConfig.baseUrl);
	const candidates = getChunkEmbeddingsForRepo(
		params.repoId,
		params.embeddingConfig.model,
		endpointFingerprint,
	);
	if (candidates.length === 0) return [];

	let query: number[];
	if (params.queryEmbedding) {
		query = params.queryEmbedding;
	} else {
		const { embeddings } = await createEmbeddings([params.queryText], {
			baseUrl: params.embeddingConfig.baseUrl,
			apiKey: params.embeddingConfig.apiKey,
			model: params.embeddingConfig.model,
			timeoutMs: params.embeddingConfig.timeoutMs,
		});
		query = embeddings[0];
	}

	const scored = candidates
		.map((candidate) => ({
			filePath: candidate.filePath,
			chunkSeq: candidate.chunkSeq,
			chunkText: candidate.chunkText,
			offsetStart: candidate.offsetStart,
			offsetEnd: candidate.offsetEnd,
			score: cosineSimilarity(query, candidate.embedding),
		}))
		.filter((item) => Number.isFinite(item.score))
		.sort((a, b) => b.score - a.score);

	const top = scored.slice(0, params.topK);
	const selected: RetrievedChunk[] = [];
	let usedChars = 0;

	for (const chunk of top) {
		const remaining = params.maxContextChars - usedChars;
		if (remaining <= 0) break;

		const text = clampChunkText(chunk.chunkText, remaining);
		if (text.length === 0) continue;
		selected.push({
			filePath: chunk.filePath,
			chunkSeq: chunk.chunkSeq,
			chunkText: text,
			offsetStart: chunk.offsetStart,
			offsetEnd: chunk.offsetEnd,
			score: chunk.score,
		});
		usedChars += text.length;
	}

	return selected;
}

/**
 * Merges two chunk lists, deduplicating by (filePath, chunkSeq) and keeping
 * the highest-scoring version. Returns sorted by score descending, trimmed to budget.
 */
export function mergeAndDedupeChunks(
	primary: RetrievedChunk[],
	secondary: RetrievedChunk[],
	maxContextChars: number,
): RetrievedChunk[] {
	const seen = new Map<string, RetrievedChunk>();
	for (const chunk of [...primary, ...secondary]) {
		const key = `${chunk.filePath}:${chunk.chunkSeq}`;
		const existing = seen.get(key);
		if (!existing || chunk.score > existing.score) {
			seen.set(key, chunk);
		}
	}

	const merged = [...seen.values()].sort((a, b) => b.score - a.score);
	const selected: RetrievedChunk[] = [];
	let usedChars = 0;

	for (const chunk of merged) {
		const remaining = maxContextChars - usedChars;
		if (remaining <= 0) break;

		const text = clampChunkText(chunk.chunkText, remaining);
		if (text.length === 0) continue;
		selected.push({ ...chunk, chunkText: text });
		usedChars += text.length;
	}

	return selected;
}
