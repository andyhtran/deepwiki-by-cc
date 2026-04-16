import { json } from "@sveltejs/kit";
import { z } from "zod";
import {
	config,
	getEffectiveEmbeddingConfig,
	getEffectiveRetrievalConfig,
} from "$lib/server/config.js";
import { getAllSettings, setSetting } from "$lib/server/db/settings.js";
import type { RequestHandler } from "./$types.js";

const updateSchema = z
	.object({
		enabled: z.boolean().optional(),
		baseUrl: z.string().url().optional(),
		apiKey: z.string().optional(),
		model: z.string().min(1).optional(),
		topK: z.number().int().min(1).max(30).optional(),
		maxContextChars: z.number().int().min(1000).max(200_000).optional(),
		timeoutMs: z.number().int().min(1000).max(120_000).optional(),
		chunkSize: z.number().int().min(200).max(8000).optional(),
		chunkOverlap: z.number().int().min(0).max(2000).optional(),
		batchSize: z.number().int().min(1).max(128).optional(),
		// Retrieval mode per surface
		retrievalModeGeneration: z.enum(["constrained", "hybrid_auto"]).optional(),
		retrievalModeMcp: z.enum(["constrained", "hybrid_auto"]).optional(),
		// MCP-specific retrieval overrides
		mcpTopK: z.number().int().min(1).max(50).optional(),
		mcpMaxContextChars: z.number().int().min(1000).max(500_000).optional(),
		// Weakness detection thresholds
		weaknessMinChunks: z.number().int().min(1).max(20).optional(),
		weaknessMinContextChars: z.number().int().min(500).max(50_000).optional(),
		weaknessMinTopScore: z.number().min(0).max(1).optional(),
		weaknessMinScoreGap: z.number().min(0).max(1).optional(),
	})
	.refine(
		(value) =>
			value.chunkOverlap === undefined ||
			value.chunkSize === undefined ||
			value.chunkOverlap < value.chunkSize,
		{
			path: ["chunkOverlap"],
			message: "chunkOverlap must be less than chunkSize",
		},
	);

function toStoredPairs(payload: z.infer<typeof updateSchema>): [string, string][] {
	const pairs: [string, string][] = [];
	if (payload.enabled !== undefined) {
		pairs.push(["embeddingsEnabled", payload.enabled ? "true" : "false"]);
	}
	if (payload.baseUrl !== undefined) {
		pairs.push(["embeddingsBaseUrl", payload.baseUrl.trim()]);
	}
	if (payload.apiKey !== undefined) {
		pairs.push(["embeddingsApiKey", payload.apiKey]);
	}
	if (payload.model !== undefined) {
		pairs.push(["embeddingsModel", payload.model.trim()]);
	}
	if (payload.topK !== undefined) {
		pairs.push(["embeddingsTopK", String(payload.topK)]);
	}
	if (payload.maxContextChars !== undefined) {
		pairs.push(["embeddingsMaxContextChars", String(payload.maxContextChars)]);
	}
	if (payload.timeoutMs !== undefined) {
		pairs.push(["embeddingsTimeoutMs", String(payload.timeoutMs)]);
	}
	if (payload.chunkSize !== undefined) {
		pairs.push(["embeddingsChunkSize", String(payload.chunkSize)]);
	}
	if (payload.chunkOverlap !== undefined) {
		pairs.push(["embeddingsChunkOverlap", String(payload.chunkOverlap)]);
	}
	if (payload.batchSize !== undefined) {
		pairs.push(["embeddingsBatchSize", String(payload.batchSize)]);
	}
	if (payload.retrievalModeGeneration !== undefined) {
		pairs.push(["retrievalModeGeneration", payload.retrievalModeGeneration]);
	}
	if (payload.retrievalModeMcp !== undefined) {
		pairs.push(["retrievalModeMcp", payload.retrievalModeMcp]);
	}
	if (payload.mcpTopK !== undefined) {
		pairs.push(["mcpTopK", String(payload.mcpTopK)]);
	}
	if (payload.mcpMaxContextChars !== undefined) {
		pairs.push(["mcpMaxContextChars", String(payload.mcpMaxContextChars)]);
	}
	if (payload.weaknessMinChunks !== undefined) {
		pairs.push(["weaknessMinChunks", String(payload.weaknessMinChunks)]);
	}
	if (payload.weaknessMinContextChars !== undefined) {
		pairs.push(["weaknessMinContextChars", String(payload.weaknessMinContextChars)]);
	}
	if (payload.weaknessMinTopScore !== undefined) {
		pairs.push(["weaknessMinTopScore", String(payload.weaknessMinTopScore)]);
	}
	if (payload.weaknessMinScoreGap !== undefined) {
		pairs.push(["weaknessMinScoreGap", String(payload.weaknessMinScoreGap)]);
	}
	return pairs;
}

export const GET: RequestHandler = async () => {
	const settings = getAllSettings();
	const current = getEffectiveEmbeddingConfig(settings);
	const retrieval = getEffectiveRetrievalConfig(settings);
	return json({
		current,
		retrieval,
		defaults: {
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
		retrievalDefaults: {
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
	});
};

export const PUT: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const parsed = updateSchema.safeParse(body);
	if (!parsed.success) {
		return json(
			{
				error: "Invalid embeddings settings payload",
				issues: parsed.error.issues.map((issue) => ({
					path: issue.path.join("."),
					message: issue.message,
				})),
			},
			{ status: 400 },
		);
	}

	for (const [key, value] of toStoredPairs(parsed.data)) {
		setSetting(key, value);
	}

	return json({ success: true });
};
