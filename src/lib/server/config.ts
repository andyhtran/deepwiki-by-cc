import { resolve } from "node:path";

export type GenerationProvider = "claude-cli" | "codex-cli";

interface GenerationModelInfo {
	name: string;
	provider: GenerationProvider;
	cliModel: string;
	reasoningEffort?: string;
	input?: number;
	output?: number;
}

export const GENERATION_MODELS = {
	"claude-sonnet-4-6": {
		name: "Claude Sonnet 4.6",
		provider: "claude-cli",
		cliModel: "claude-sonnet-4-6",
		input: 3.0,
		output: 15.0,
	},
	"claude-opus-4-6": {
		name: "Claude Opus 4.6",
		provider: "claude-cli",
		cliModel: "claude-opus-4-6",
		input: 5.0,
		output: 25.0,
	},
	"codex-gpt-5-3": {
		name: "Codex (gpt-5.3-codex)",
		provider: "codex-cli",
		cliModel: "gpt-5.3-codex",
		reasoningEffort: "medium",
		input: 1.75,
		output: 14.0,
	},
	"codex-gpt-5-3-xhigh": {
		name: "Codex (gpt-5.3-codex, xhigh)",
		provider: "codex-cli",
		cliModel: "gpt-5.3-codex",
		reasoningEffort: "xhigh",
		input: 1.75,
		output: 14.0,
	},
} as const satisfies Record<string, GenerationModelInfo>;

export type GenerationModelId = keyof typeof GENERATION_MODELS;

export type RetrievalMode = "constrained" | "hybrid_auto";

const DEFAULT_GENERATION_MODEL: GenerationModelId = "claude-sonnet-4-6";

export const config = {
	generationModel: DEFAULT_GENERATION_MODEL,
	dataDir: resolve("./data"),
	maxFileSize: 1048576,
	maxFilesPerRepo: 10000,
	parallelPageLimit: 2,
	embeddingEnabled: false,
	embeddingBaseUrl: "https://api.openai.com/v1/embeddings",
	embeddingModel: "text-embedding-3-small",
	embeddingTopK: 10,
	embeddingMaxContextChars: 16_000,
	embeddingRequestTimeoutMs: 30_000,
	embeddingChunkSize: 1200,
	embeddingChunkOverlap: 200,
	embeddingBatchSize: 32,
	// Retrieval mode defaults per surface
	retrievalModeGeneration: "constrained",
	retrievalModeMcp: "hybrid_auto",
	// MCP/chat retrieval defaults (generation uses embeddingTopK/embeddingMaxContextChars)
	mcpTopK: 20,
	mcpMaxContextChars: 32_000,
	// Weakness detection thresholds for hybrid_auto fallback
	weaknessMinChunks: 3,
	weaknessMinContextChars: 4000,
	weaknessMinTopScore: 0.3,
	weaknessMinScoreGap: 0.05,
} as const;

export function isGenerationModel(modelId: string): modelId is GenerationModelId {
	return modelId in GENERATION_MODELS;
}

export function resolveGenerationModel(modelId: string | null | undefined): GenerationModelId {
	if (modelId && isGenerationModel(modelId)) {
		return modelId;
	}
	return config.generationModel;
}

export function getGenerationModel(modelId: string): GenerationModelInfo | undefined {
	if (!isGenerationModel(modelId)) return undefined;
	return GENERATION_MODELS[modelId];
}

export interface EffectiveEmbeddingConfig {
	enabled: boolean;
	baseUrl: string;
	apiKey: string;
	model: string;
	topK: number;
	maxContextChars: number;
	timeoutMs: number;
	chunkSize: number;
	chunkOverlap: number;
	batchSize: number;
}

export interface WeaknessThresholds {
	minChunks: number;
	minContextChars: number;
	minTopScore: number;
	minScoreGap: number;
}

export interface SurfaceRetrievalConfig {
	mode: RetrievalMode;
	topK: number;
	maxContextChars: number;
}

export interface EffectiveRetrievalConfig {
	generation: SurfaceRetrievalConfig;
	mcp: SurfaceRetrievalConfig;
	weakness: WeaknessThresholds;
}

function parseBooleanSetting(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined) return fallback;
	const normalized = value.trim().toLowerCase();
	if (normalized === "true") return true;
	if (normalized === "false") return false;
	return fallback;
}

function parseIntegerSetting(
	value: string | undefined,
	fallback: number,
	min: number,
	max: number,
): number {
	if (value === undefined) return fallback;
	const n = Number(value);
	if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

function parseFloatSetting(
	value: string | undefined,
	fallback: number,
	min: number,
	max: number,
): number {
	if (value === undefined) return fallback;
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

function parseRetrievalMode(value: string | undefined, fallback: RetrievalMode): RetrievalMode {
	if (value === "constrained" || value === "hybrid_auto") return value;
	return fallback;
}

export function getEffectiveRetrievalConfig(
	settings: Record<string, string>,
): EffectiveRetrievalConfig {
	return {
		generation: {
			mode: parseRetrievalMode(settings.retrievalModeGeneration, config.retrievalModeGeneration),
			// Generation surfaces reuse the existing embedding topK/maxContextChars settings
			topK: parseIntegerSetting(settings.embeddingsTopK, config.embeddingTopK, 1, 30),
			maxContextChars: parseIntegerSetting(
				settings.embeddingsMaxContextChars,
				config.embeddingMaxContextChars,
				1000,
				200_000,
			),
		},
		mcp: {
			mode: parseRetrievalMode(settings.retrievalModeMcp, config.retrievalModeMcp),
			topK: parseIntegerSetting(settings.mcpTopK, config.mcpTopK, 1, 50),
			maxContextChars: parseIntegerSetting(
				settings.mcpMaxContextChars,
				config.mcpMaxContextChars,
				1000,
				500_000,
			),
		},
		weakness: {
			minChunks: parseIntegerSetting(settings.weaknessMinChunks, config.weaknessMinChunks, 1, 20),
			minContextChars: parseIntegerSetting(
				settings.weaknessMinContextChars,
				config.weaknessMinContextChars,
				500,
				50_000,
			),
			minTopScore: parseFloatSetting(
				settings.weaknessMinTopScore,
				config.weaknessMinTopScore,
				0,
				1,
			),
			minScoreGap: parseFloatSetting(
				settings.weaknessMinScoreGap,
				config.weaknessMinScoreGap,
				0,
				1,
			),
		},
	};
}

export function getEffectiveEmbeddingConfig(
	settings: Record<string, string>,
): EffectiveEmbeddingConfig {
	const baseUrl = (settings.embeddingsBaseUrl || config.embeddingBaseUrl).trim();
	const model = (settings.embeddingsModel || config.embeddingModel).trim();
	const apiKey = settings.embeddingsApiKey || "";

	return {
		enabled: parseBooleanSetting(settings.embeddingsEnabled, config.embeddingEnabled),
		baseUrl: baseUrl.length > 0 ? baseUrl : config.embeddingBaseUrl,
		apiKey,
		model: model.length > 0 ? model : config.embeddingModel,
		topK: parseIntegerSetting(settings.embeddingsTopK, config.embeddingTopK, 1, 30),
		maxContextChars: parseIntegerSetting(
			settings.embeddingsMaxContextChars,
			config.embeddingMaxContextChars,
			1000,
			200_000,
		),
		timeoutMs: parseIntegerSetting(
			settings.embeddingsTimeoutMs,
			config.embeddingRequestTimeoutMs,
			1000,
			120_000,
		),
		chunkSize: parseIntegerSetting(
			settings.embeddingsChunkSize,
			config.embeddingChunkSize,
			200,
			8000,
		),
		chunkOverlap: parseIntegerSetting(
			settings.embeddingsChunkOverlap,
			config.embeddingChunkOverlap,
			0,
			2000,
		),
		batchSize: parseIntegerSetting(settings.embeddingsBatchSize, config.embeddingBatchSize, 1, 128),
	};
}

export function getEffectiveConfig(settings: Record<string, string>): {
	generationModel: GenerationModelId;
	parallelPageLimit: number;
	embeddings: EffectiveEmbeddingConfig;
	retrieval: EffectiveRetrievalConfig;
} {
	const raw = Number(settings.parallelPageLimit);
	const parallelPageLimit = Number.isNaN(raw)
		? config.parallelPageLimit
		: Math.max(1, Math.min(5, raw));
	return {
		generationModel: resolveGenerationModel(settings.generationModel),
		parallelPageLimit,
		embeddings: getEffectiveEmbeddingConfig(settings),
		retrieval: getEffectiveRetrievalConfig(settings),
	};
}

const MODEL_PRICING: Record<string, { input: number; output: number }> = {};
for (const [id, info] of Object.entries(GENERATION_MODELS)) {
	if (typeof info.input === "number" && typeof info.output === "number") {
		MODEL_PRICING[id] = {
			input: info.input / 1000,
			output: info.output / 1000,
		};
	}
}

export function calculateCost(
	modelId: string,
	promptTokens: number,
	completionTokens: number,
): number {
	const pricing = MODEL_PRICING[modelId];
	if (!pricing) return 0;
	return (promptTokens / 1000) * pricing.input + (completionTokens / 1000) * pricing.output;
}
