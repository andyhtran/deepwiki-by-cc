import {
	getEffectiveEmbeddingConfig,
	getEffectiveRetrievalConfig,
	type RetrievalMode,
} from "../config.js";
import { getDb } from "../db/index.js";
import { getAllSettings } from "../db/settings.js";
import {
	computeRetrievalMetadata,
	isRetrievalWeak,
	mergeAndDedupeChunks,
	type RetrievedChunk,
	retrieveGlobalChunks,
	retrieveRelevantChunks,
} from "../embeddings/retrieval.js";
import { log } from "../logger.js";

export type RetrievalSurface = "generation" | "mcp";

export interface FileContent {
	filePath: string;
	language: string | null;
	content: string;
}

export function retrieveFileContents(repoId: number, filePaths: string[]): FileContent[] {
	if (filePaths.length === 0) return [];

	const db = getDb();
	const placeholders = filePaths.map(() => "?").join(",");

	const rows = db
		.prepare(
			`SELECT file_path, language, content
			 FROM documents
			 WHERE repo_id = ? AND file_path IN (${placeholders})
			 ORDER BY file_path`,
		)
		.all(repoId, ...filePaths) as { file_path: string; language: string | null; content: string }[];

	return rows.map((row) => ({
		filePath: row.file_path,
		language: row.language,
		content: row.content,
	}));
}

export function formatFilesForContext(files: FileContent[]): string {
	const parts: string[] = [];

	for (const file of files) {
		const lang = file.language || "";
		parts.push(`### ${file.filePath}`);
		parts.push(`\`\`\`${lang}`);
		parts.push(file.content);
		parts.push("```");
		parts.push("");
	}

	let result = parts.join("\n");
	if (result.length > 100_000) {
		const truncated = result.slice(0, 100_000);
		const includedFiles = new Set(
			files.filter((f) => truncated.includes(`### ${f.filePath}`)).map((f) => f.filePath),
		);
		const droppedFiles = files.filter((f) => !includedFiles.has(f.filePath)).map((f) => f.filePath);

		result = truncated;
		result += "\n\n... (context truncated)";
		if (droppedFiles.length > 0) {
			result += `\n\nFiles omitted due to context limit:\n${droppedFiles.map((f) => `- ${f}`).join("\n")}`;
		}
	}

	return result;
}

export function formatChunksForContext(chunks: RetrievedChunk[]): string {
	const parts: string[] = [];

	for (const chunk of chunks) {
		parts.push(
			`### ${chunk.filePath} (chunk ${chunk.chunkSeq}, chars ${chunk.offsetStart}-${chunk.offsetEnd})`,
		);
		parts.push("```");
		parts.push(chunk.chunkText);
		parts.push("```");
		parts.push("");
	}

	return parts.join("\n");
}

export async function retrieveContextForPrompt(params: {
	repoId: number;
	filePaths: string[];
	queryText: string;
	surface?: RetrievalSurface;
}): Promise<{ codeContext: string; source: "embeddings" | "embeddings_hybrid" | "files" }> {
	const settings = getAllSettings();
	const embeddingConfig = getEffectiveEmbeddingConfig(settings);
	const retrievalConfig = getEffectiveRetrievalConfig(settings);

	const surface = params.surface ?? "generation";
	const surfaceConfig = surface === "mcp" ? retrievalConfig.mcp : retrievalConfig.generation;

	if (embeddingConfig.enabled) {
		try {
			const result = await retrieveWithMode({
				repoId: params.repoId,
				filePaths: params.filePaths,
				queryText: params.queryText,
				embeddingConfig,
				mode: surfaceConfig.mode,
				topK: surfaceConfig.topK,
				maxContextChars: surfaceConfig.maxContextChars,
				weakness: retrievalConfig.weakness,
			});
			if (result) {
				return result;
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			log.embeddings.warn(
				{
					repoId: params.repoId,
					fileCount: params.filePaths.length,
					surface,
					err: msg,
				},
				"embedding retrieval failed, falling back to file retrieval",
			);
		}
	}

	const files = retrieveFileContents(params.repoId, params.filePaths);
	return {
		codeContext: formatFilesForContext(files),
		source: "files",
	};
}

/**
 * Runs retrieval in the specified mode, returning null if no useful chunks found.
 * In hybrid_auto mode: runs constrained first, checks for weakness, falls back to global.
 */
async function retrieveWithMode(params: {
	repoId: number;
	filePaths: string[];
	queryText: string;
	embeddingConfig: ReturnType<typeof getEffectiveEmbeddingConfig>;
	mode: RetrievalMode;
	topK: number;
	maxContextChars: number;
	weakness: ReturnType<typeof getEffectiveRetrievalConfig>["weakness"];
}): Promise<{ codeContext: string; source: "embeddings" | "embeddings_hybrid" } | null> {
	// Override topK/maxContextChars on the embedding config for this retrieval call
	const constrainedConfig = {
		...params.embeddingConfig,
		topK: params.topK,
		maxContextChars: params.maxContextChars,
	};

	// Constrained retrieval (file-scoped)
	const constrainedChunks = await retrieveRelevantChunks({
		repoId: params.repoId,
		filePaths: params.filePaths,
		queryText: params.queryText,
		embeddingConfig: constrainedConfig,
	});

	if (params.mode === "constrained") {
		if (constrainedChunks.length === 0) return null;
		return { codeContext: formatChunksForContext(constrainedChunks), source: "embeddings" };
	}

	// hybrid_auto: check if constrained results look weak
	const metadata = computeRetrievalMetadata(constrainedChunks);
	const { weak, reasons } = isRetrievalWeak(metadata, params.weakness);

	if (!weak && constrainedChunks.length > 0) {
		return { codeContext: formatChunksForContext(constrainedChunks), source: "embeddings" };
	}

	// Constrained was weak — fall back to global retrieval
	log.retrieval.info(
		{
			repoId: params.repoId,
			constrainedChunks: metadata.chunkCount,
			reasons,
		},
		"constrained retrieval weak, falling back to global",
	);

	const globalChunks = await retrieveGlobalChunks({
		repoId: params.repoId,
		queryText: params.queryText,
		embeddingConfig: params.embeddingConfig,
		topK: params.topK,
		maxContextChars: params.maxContextChars,
	});

	if (globalChunks.length === 0 && constrainedChunks.length === 0) return null;

	// Merge constrained + global, dedupe, and trim to budget
	const merged = mergeAndDedupeChunks(constrainedChunks, globalChunks, params.maxContextChars);
	if (merged.length === 0) return null;

	log.retrieval.debug(
		{
			repoId: params.repoId,
			constrainedCount: constrainedChunks.length,
			globalCount: globalChunks.length,
			mergedCount: merged.length,
		},
		"hybrid retrieval merged results",
	);

	return { codeContext: formatChunksForContext(merged), source: "embeddings_hybrid" };
}
