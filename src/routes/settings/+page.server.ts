import {
	config,
	GENERATION_MODELS,
	getEffectiveConfig,
	getEffectiveRetrievalConfig,
} from "$lib/server/config.js";
import { getAllSettings } from "$lib/server/db/settings.js";
import type { PageServerLoad } from "./$types.js";

export const load: PageServerLoad = async () => {
	const settings = getAllSettings();

	const generationModels = Object.entries(GENERATION_MODELS).map(([id, info]) => ({
		id,
		name: info.name,
		input: info.input ?? null,
		output: info.output ?? null,
	}));

	const effective = getEffectiveConfig(settings);
	const retrieval = getEffectiveRetrievalConfig(settings);

	return {
		current: {
			generationModel: effective.generationModel,
			parallelPageLimit: effective.parallelPageLimit,
			embeddings: effective.embeddings,
			retrieval,
		},
		defaults: {
			generationModel: config.generationModel,
			parallelPageLimit: config.parallelPageLimit,
			embeddings: {
				enabled: config.embeddingEnabled,
				baseUrl: config.embeddingBaseUrl,
				apiKey: "",
				model: config.embeddingModel,
				topK: config.embeddingTopK,
				maxContextChars: config.embeddingMaxContextChars,
				timeoutMs: config.embeddingRequestTimeoutMs,
				chunkSize: config.embeddingChunkSize,
				chunkOverlap: config.embeddingChunkOverlap,
				batchSize: config.embeddingBatchSize,
			},
			retrieval: {
				generation: {
					mode: config.retrievalModeGeneration,
					topK: config.embeddingTopK,
					maxContextChars: config.embeddingMaxContextChars,
				},
				mcp: {
					mode: config.retrievalModeMcp,
					topK: config.mcpTopK,
					maxContextChars: config.mcpMaxContextChars,
				},
				weakness: {
					minChunks: config.weaknessMinChunks,
					minContextChars: config.weaknessMinContextChars,
					minTopScore: config.weaknessMinTopScore,
					minScoreGap: config.weaknessMinScoreGap,
				},
			},
		},
		generationModels,
	};
};
