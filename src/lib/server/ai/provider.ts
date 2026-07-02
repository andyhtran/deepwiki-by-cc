import { getGenerationModel } from "../config.js";
import { invokeClaudeCli } from "./claude-cli.js";
import { invokeCodexCli } from "./codex-cli.js";

export interface InvokeGenerationModelOptions {
	prompt: string;
	modelId: string;
	systemPrompt?: string;
	timeoutMs?: number;
	jsonSchema?: Record<string, unknown>;
	/** Working directory for the CLI process (agentic exploration root). */
	cwd?: string;
	/** Claude only: restrict + auto-approve exactly these tools. */
	tools?: readonly string[];
	/** Claude only: per-invocation spend cap. */
	maxBudgetUsd?: number;
}

export interface InvokeGenerationModelResult {
	text: string;
	structuredOutput?: unknown;
	costUsd?: number;
	durationMs?: number;
	inputTokens?: number;
	outputTokens?: number;
	/** Codex only: subset of inputTokens served from prompt cache (~10% price). */
	cachedInputTokens?: number;
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
			cwd: options.cwd,
			tools: options.tools,
			maxBudgetUsd: options.maxBudgetUsd,
		});
	}

	return invokeCodexCli({
		prompt: options.prompt,
		systemPrompt: options.systemPrompt,
		model: model.cliModel,
		reasoningEffort: model.reasoningEffort ?? "medium",
		timeoutMs: options.timeoutMs,
		jsonSchema: options.jsonSchema,
		cwd: options.cwd,
	});
}
