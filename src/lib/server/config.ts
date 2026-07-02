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
	"gpt-5.5": {
		name: "gpt-5.5 (medium)",
		provider: "codex-cli",
		cliModel: "gpt-5.5",
		reasoningEffort: "medium",
		input: 1.75,
		output: 14.0,
	},
	"gpt-5.5-xhigh": {
		name: "gpt-5.5 (xhigh)",
		provider: "codex-cli",
		cliModel: "gpt-5.5",
		reasoningEffort: "xhigh",
		input: 1.75,
		output: 14.0,
	},
} as const satisfies Record<string, GenerationModelInfo>;

export type GenerationModelId = keyof typeof GENERATION_MODELS;

const DEFAULT_GENERATION_MODEL: GenerationModelId = "claude-sonnet-4-6";

export const config = {
	generationModel: DEFAULT_GENERATION_MODEL,
	// DEEPWIKI_DATA_DIR must be set before this module is imported (the eval
	// harness relies on it to isolate its SQLite data from the real one).
	dataDir: resolve(process.env.DEEPWIKI_DATA_DIR ?? "./data"),
	maxFileSize: 1048576,
	maxFilesPerRepo: 10000,
	parallelPageLimit: 2,
	showRepoOwner: true,
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

export interface EffectiveDisplayConfig {
	showRepoOwner: boolean;
}

function parseBooleanSetting(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined) return fallback;
	const normalized = value.trim().toLowerCase();
	if (normalized === "true") return true;
	if (normalized === "false") return false;
	return fallback;
}

export function getEffectiveDisplayConfig(
	settings: Record<string, string>,
): EffectiveDisplayConfig {
	return {
		showRepoOwner: parseBooleanSetting(settings.showRepoOwner, config.showRepoOwner),
	};
}

export function getEffectiveConfig(settings: Record<string, string>): {
	generationModel: GenerationModelId;
	parallelPageLimit: number;
	display: EffectiveDisplayConfig;
} {
	const raw = Number(settings.parallelPageLimit);
	const parallelPageLimit = Number.isNaN(raw)
		? config.parallelPageLimit
		: Math.max(1, Math.min(5, raw));
	return {
		generationModel: resolveGenerationModel(settings.generationModel),
		parallelPageLimit,
		display: getEffectiveDisplayConfig(settings),
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

// OpenAI bills cached input at 10% of the normal input rate. Claude runs
// don't use this path (the CLI reports exact cost), so a single ratio for
// codex-cli models is sufficient.
const CACHED_INPUT_PRICE_RATIO = 0.1;

export function calculateCost(
	modelId: string,
	promptTokens: number,
	completionTokens: number,
	cachedTokens = 0,
): number {
	const pricing = MODEL_PRICING[modelId];
	if (!pricing) return 0;
	const cached = Math.min(Math.max(cachedTokens, 0), promptTokens);
	const freshInputCost = ((promptTokens - cached) / 1000) * pricing.input;
	const cachedInputCost = (cached / 1000) * pricing.input * CACHED_INPUT_PRICE_RATIO;
	return freshInputCost + cachedInputCost + (completionTokens / 1000) * pricing.output;
}
