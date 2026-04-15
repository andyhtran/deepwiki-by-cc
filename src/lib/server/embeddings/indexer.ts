import type { EffectiveEmbeddingConfig } from "../config.js";
import {
	type ChunkWithEmbeddingInput,
	getEmbeddedHashesByFile,
	replaceFileEmbeddings,
} from "../db/embeddings.js";
import { log } from "../logger.js";
import type { ScannedFile } from "../pipeline/scanner.js";
import { chunkTextDeterministic } from "./chunker.js";
import { createEmbeddings, createEndpointFingerprint } from "./client.js";

export interface EmbeddingIndexingSummary {
	consideredFiles: number;
	indexedFiles: number;
	skippedFiles: number;
	failedFiles: string[];
}

export function selectFilesNeedingEmbeddingRefresh(
	files: ScannedFile[],
	embeddedHashesByFile: Map<string, Set<string>>,
): ScannedFile[] {
	return files.filter((file) => {
		const hashes = embeddedHashesByFile.get(file.filePath);
		return !hashes?.has(file.contentHash);
	});
}

function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
	if (items.length === 0) return [];
	const batches: T[][] = [];
	for (let i = 0; i < items.length; i += batchSize) {
		batches.push(items.slice(i, i + batchSize));
	}
	return batches;
}

export async function refreshEmbeddingsForScannedFiles(params: {
	repoId: number;
	files: ScannedFile[];
	embeddingConfig: EffectiveEmbeddingConfig;
}): Promise<EmbeddingIndexingSummary> {
	if (!params.embeddingConfig.enabled) {
		return {
			consideredFiles: params.files.length,
			indexedFiles: 0,
			skippedFiles: params.files.length,
			failedFiles: [],
		};
	}

	const filePaths = params.files.map((f) => f.filePath);
	const endpointFingerprint = createEndpointFingerprint(params.embeddingConfig.baseUrl);
	const embeddedHashesByFile = getEmbeddedHashesByFile(
		params.repoId,
		filePaths,
		params.embeddingConfig.model,
		endpointFingerprint,
	);

	const filesToIndex = selectFilesNeedingEmbeddingRefresh(params.files, embeddedHashesByFile);
	if (filesToIndex.length === 0) {
		return {
			consideredFiles: params.files.length,
			indexedFiles: 0,
			skippedFiles: params.files.length,
			failedFiles: [],
		};
	}

	const failedFiles: string[] = [];
	let indexedFiles = 0;

	for (const file of filesToIndex) {
		try {
			const chunks = chunkTextDeterministic(file.content, {
				chunkSize: params.embeddingConfig.chunkSize,
				chunkOverlap: params.embeddingConfig.chunkOverlap,
			});

			if (chunks.length === 0) {
				continue;
			}

			const vectors: number[][] = [];
			const batches = splitIntoBatches(chunks, params.embeddingConfig.batchSize);

			for (const batch of batches) {
				const { embeddings } = await createEmbeddings(
					batch.map((chunk) => chunk.chunkText),
					{
						baseUrl: params.embeddingConfig.baseUrl,
						apiKey: params.embeddingConfig.apiKey,
						model: params.embeddingConfig.model,
						timeoutMs: params.embeddingConfig.timeoutMs,
					},
				);
				vectors.push(...embeddings);
			}

			if (vectors.length !== chunks.length) {
				throw new Error(
					`Vector/chunk mismatch for ${file.filePath}: ${vectors.length} vectors for ${chunks.length} chunks`,
				);
			}

			const payload: ChunkWithEmbeddingInput[] = chunks.map((chunk, index) => ({
				chunkSeq: chunk.chunkSeq,
				chunkText: chunk.chunkText,
				offsetStart: chunk.offsetStart,
				offsetEnd: chunk.offsetEnd,
				tokenCount: chunk.tokenCount,
				embedding: vectors[index],
			}));

			replaceFileEmbeddings({
				repoId: params.repoId,
				filePath: file.filePath,
				contentHash: file.contentHash,
				embeddingModel: params.embeddingConfig.model,
				endpointFingerprint,
				chunks: payload,
			});
			indexedFiles++;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			failedFiles.push(file.filePath);
			log.embeddings.error(
				{
					repoId: params.repoId,
					filePath: file.filePath,
					err: message,
				},
				"embedding index refresh failed",
			);
		}
	}

	return {
		consideredFiles: params.files.length,
		indexedFiles,
		skippedFiles: params.files.length - indexedFiles - failedFiles.length,
		failedFiles,
	};
}
