import { getGenerationModel } from "../config.js";
import { invokeClaudeCli } from "./claude-cli.js";
import { invokeCodexCli } from "./codex-cli.js";

export interface InvokeGenerationModelOptions {
	prompt: string;
	modelId: string;
	systemPrompt?: string;
	timeoutMs?: number;
	jsonSchema?: Record<string, unknown>;
}

export interface InvokeGenerationModelResult {
	text: string;
	structuredOutput?: unknown;
	costUsd?: number;
	durationMs?: number;
	inputTokens?: number;
	outputTokens?: number;
}

export async function invokeGenerationModel(
	options: InvokeGenerationModelOptions,
): Promise<InvokeGenerationModelResult> {
	const model = getGenerationModel(options.modelId);
	if (!model) {
		throw new Error(`Unsupported generation model: ${options.modelId}`);
	}

	if (model.provider === "claude-cli") {
		return invokeClaudeCli({
			prompt: options.prompt,
			systemPrompt: options.systemPrompt,
			model: model.cliModel,
			timeoutMs: options.timeoutMs,
			jsonSchema: options.jsonSchema,
		});
	}

	return invokeCodexCli({
		prompt: options.prompt,
		systemPrompt: options.systemPrompt,
		model: model.cliModel,
		reasoningEffort: model.reasoningEffort ?? "medium",
		timeoutMs: options.timeoutMs,
		jsonSchema: options.jsonSchema,
	});
}
