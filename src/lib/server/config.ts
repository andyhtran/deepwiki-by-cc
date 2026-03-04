import { resolve } from "node:path";

export const config = {
	generationModel: "claude-sonnet-4-6",
	dataDir: resolve("./data"),
	maxFileSize: 1048576,
	maxFilesPerRepo: 10000,
	parallelPageLimit: 2,
} as const;

export function getEffectiveConfig(settings: Record<string, string>): {
	generationModel: string;
	parallelPageLimit: number;
} {
	const raw = Number(settings.parallelPageLimit);
	const parallelPageLimit = Number.isNaN(raw)
		? config.parallelPageLimit
		: Math.max(1, Math.min(5, raw));
	return {
		generationModel: settings.generationModel || config.generationModel,
		parallelPageLimit,
	};
}

interface ClaudeModelInfo {
	name: string;
	input: number;
	output: number;
}

export const CLAUDE_MODELS: Record<string, ClaudeModelInfo> = {
	"claude-sonnet-4-6": {
		name: "Claude Sonnet 4.6",
		input: 3.0,
		output: 15.0,
	},
	"claude-opus-4-6": {
		name: "Claude Opus 4.6",
		input: 5.0,
		output: 25.0,
	},
};

const MODEL_PRICING: Record<string, { input: number; output: number }> = {};
for (const [id, info] of Object.entries(CLAUDE_MODELS)) {
	MODEL_PRICING[id] = {
		input: info.input / 1000,
		output: info.output / 1000,
	};
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
