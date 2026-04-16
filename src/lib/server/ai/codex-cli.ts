import { type ChildProcess, execSync, spawn as nodeSpawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { log } from "../logger.js";

// Track active codex child processes so they can be killed on cancellation.
const activeProcesses = new Set<ChildProcess>();

/** Kill all currently running codex child processes (used for job cancellation). */
export function killActiveCodexProcesses(): void {
	for (const proc of activeProcesses) {
		proc.kill();
	}
}

interface CodexCliOptions {
	prompt: string;
	systemPrompt?: string;
	model: string;
	reasoningEffort: string;
	timeoutMs?: number;
	jsonSchema?: Record<string, unknown>;
}

interface CodexCliResult {
	text: string;
	structuredOutput?: unknown;
	costUsd?: number;
	durationMs?: number;
	inputTokens?: number;
	outputTokens?: number;
}

interface CodexJsonEvent {
	type: string;
	item?: {
		type?: string;
		text?: string;
	};
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
		cached_input_tokens?: number;
	};
	message?: string;
	error?: {
		message?: string;
	};
}

interface CodexStreamState {
	agentMessages: string[];
	inputTokens?: number;
	outputTokens?: number;
	isError: boolean;
	errorMessage?: string;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkCodexInstalled(): void {
	try {
		execSync("codex --version", { timeout: 5000, stdio: "pipe" });
	} catch {
		throw new Error(
			"Codex CLI is not installed or not in PATH. Install it from https://developers.openai.com/codex/cli",
		);
	}
}

function buildPrompt(prompt: string, systemPrompt?: string): string {
	if (!systemPrompt) return prompt;
	return `System instructions:\n${systemPrompt}\n\nUser request:\n${prompt}`;
}

function normalizeSchema(schema: unknown): unknown {
	if (Array.isArray(schema)) {
		return schema.map((value) => normalizeSchema(value));
	}
	if (!schema || typeof schema !== "object") {
		return schema;
	}

	const input = schema as Record<string, unknown>;
	const output: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(input)) {
		if (
			(key === "properties" || key === "$defs" || key === "definitions") &&
			value &&
			typeof value === "object" &&
			!Array.isArray(value)
		) {
			const nested: Record<string, unknown> = {};
			for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
				nested[nestedKey] = normalizeSchema(nestedValue);
			}
			output[key] = nested;
			continue;
		}
		output[key] = normalizeSchema(value);
	}

	// Codex output schemas require object nodes to explicitly disable extra keys.
	if (output.type === "object" && !("additionalProperties" in output)) {
		output.additionalProperties = false;
	}

	return output;
}

function extractPotentialJson(text: string): string {
	let cleaned = text.trim();
	if (!cleaned) return cleaned;

	cleaned = cleaned.replace(/```json\n?/g, "").replace(/```\n?/g, "");
	const firstBrace = cleaned.indexOf("{");
	const lastBrace = cleaned.lastIndexOf("}");
	if (firstBrace !== -1 && lastBrace > firstBrace) {
		cleaned = cleaned.slice(firstBrace, lastBrace + 1);
	}

	return cleaned.trim();
}

export function selectFinalAgentMessage(agentMessages: string[]): string {
	for (let i = agentMessages.length - 1; i >= 0; i--) {
		const message = agentMessages[i]?.trim();
		if (message) {
			return message;
		}
	}
	return "";
}

export function parseSchemaOutputFromMessages(agentMessages: string[]): unknown {
	const finalMessage = selectFinalAgentMessage(agentMessages);
	if (!finalMessage) {
		throw new Error("No JSON object found in Codex response");
	}

	const candidates = [finalMessage];
	const extracted = extractPotentialJson(finalMessage);
	if (extracted && extracted !== finalMessage) {
		candidates.push(extracted);
	}

	let lastParseError: Error | null = null;
	for (const candidate of candidates) {
		try {
			return JSON.parse(candidate);
		} catch (error: unknown) {
			lastParseError = error instanceof Error ? error : new Error(String(error));
		}
	}

	throw new Error(lastParseError?.message || "No JSON object found in Codex response");
}

function consumeCodexEventLine(line: string, state: CodexStreamState): void {
	const trimmed = line.trim();
	if (!trimmed) return;

	let event: CodexJsonEvent;
	try {
		event = JSON.parse(trimmed);
	} catch {
		return;
	}

	if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) {
		state.agentMessages.push(event.item.text);
	}

	if (event.type === "turn.completed" && event.usage) {
		state.inputTokens = event.usage.input_tokens;
		state.outputTokens = event.usage.output_tokens;
	}

	if (event.type === "error") {
		state.isError = true;
		state.errorMessage = event.message || state.errorMessage;
	}

	if (event.type === "turn.failed") {
		state.isError = true;
		state.errorMessage = event.error?.message || state.errorMessage;
	}
}

function isRetryableError(message: string): boolean {
	const lowered = message.toLowerCase();
	return (
		lowered.includes("rate limit") ||
		lowered.includes("overloaded") ||
		lowered.includes("sigterm") ||
		lowered.includes("exit code") ||
		lowered.includes("timed out") ||
		lowered.includes("429") ||
		lowered.includes("503")
	);
}

let _checked = false;

export async function invokeCodexCli(
	options: CodexCliOptions,
	maxRetries = 3,
): Promise<CodexCliResult> {
	if (!_checked) {
		checkCodexInstalled();
		_checked = true;
	}

	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await spawnCodex(options);
		} catch (error: unknown) {
			lastError = error instanceof Error ? error : new Error(String(error));

			if (attempt < maxRetries && isRetryableError(lastError.message)) {
				const delay = 2 ** attempt * 2000;
				log.codex.warn(
					{
						attempt: attempt + 1,
						maxAttempts: maxRetries + 1,
						delayMs: delay,
						err: lastError.message,
						provider: "codex",
					},
					"retrying",
				);
				await sleep(delay);
				continue;
			}

			throw lastError;
		}
	}

	throw lastError;
}

async function spawnCodex(options: CodexCliOptions): Promise<CodexCliResult> {
	const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
	const prompt = buildPrompt(options.prompt, options.systemPrompt);
	const start = Date.now();

	// Use "-" as the prompt arg so codex reads the actual prompt from stdin.
	// This avoids E2BIG (argument list too long) for large prompts that would
	// exceed the OS ARG_MAX limit when passed as a CLI argument.
	const args = [
		"exec",
		"--json",
		"--ephemeral",
		"--skip-git-repo-check",
		"--sandbox",
		"read-only",
		"--model",
		options.model,
		"--config",
		`model_reasoning_effort="${options.reasoningEffort}"`,
	];

	let tempDir: string | null = null;

	if (options.jsonSchema) {
		tempDir = mkdtempSync(join(tmpdir(), "deepwiki-codex-schema-"));
		const schemaPath = join(tempDir, "output-schema.json");
		writeFileSync(schemaPath, JSON.stringify(normalizeSchema(options.jsonSchema)), "utf-8");
		args.push("--output-schema", schemaPath);
	}

	args.push("-");

	const cleanup = (): void => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
			tempDir = null;
		}
	};

	log.codex.info(
		{
			model: options.model,
			reasoningEffort: options.reasoningEffort,
			promptChars: prompt.length,
			hasSchema: options.jsonSchema != null,
			provider: "codex",
		},
		"spawning codex",
	);

	return new Promise<CodexCliResult>((resolve, reject) => {
		const proc = nodeSpawn("codex", args, {
			stdio: ["pipe", "pipe", "pipe"],
		});
		activeProcesses.add(proc);

		// Feed the prompt via stdin so we don't hit ARG_MAX limits.
		proc.stdin.end(prompt);

		const timeoutId = setTimeout(() => {
			proc.kill();
			cleanup();
			reject(new Error("Codex CLI timed out"));
		}, timeoutMs);

		const streamState: CodexStreamState = {
			agentMessages: [],
			isError: false,
		};
		let buffer = "";
		const stderrChunks: Buffer[] = [];

		proc.stdout.on("data", (chunk: Buffer) => {
			buffer += chunk.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";

			for (const line of lines) {
				consumeCodexEventLine(line, streamState);
			}
		});

		proc.stderr.on("data", (chunk: Buffer) => {
			stderrChunks.push(chunk);
		});

		proc.on("error", (err) => {
			clearTimeout(timeoutId);
			activeProcesses.delete(proc);
			cleanup();
			reject(new Error(`Failed to spawn Codex CLI: ${err.message}`));
		});

		proc.on("close", (exitCode) => {
			clearTimeout(timeoutId);
			activeProcesses.delete(proc);
			const stderr = Buffer.concat(stderrChunks).toString().trim();
			if (buffer.trim()) {
				// Some CLIs do not end the final JSONL event with a newline.
				consumeCodexEventLine(buffer, streamState);
			}
			cleanup();

			if (exitCode !== 0) {
				reject(
					new Error(
						`Codex CLI exit code ${exitCode}: ${stderr || streamState.errorMessage || "unknown error"}`,
					),
				);
				return;
			}

			if (streamState.isError) {
				reject(new Error(`Codex CLI error: ${streamState.errorMessage || "unknown error"}`));
				return;
			}

			const text = selectFinalAgentMessage(streamState.agentMessages);
			if (!text) {
				reject(new Error("Codex CLI returned empty response"));
				return;
			}
			if (streamState.agentMessages.length > 1) {
				log.codex.debug(
					{
						agentMessageCount: streamState.agentMessages.length,
						provider: "codex",
					},
					"multiple agent messages received; using final message as output",
				);
			}

			let structuredOutput: unknown | undefined;
			if (options.jsonSchema) {
				try {
					structuredOutput = parseSchemaOutputFromMessages(streamState.agentMessages);
				} catch (error: unknown) {
					const message = error instanceof Error ? error.message : String(error);
					const preview = streamState.agentMessages.join("\n").slice(0, 500);
					reject(
						new Error(
							`Codex CLI returned invalid JSON for schema output: ${message}\n\nRaw response:\n${preview}`,
						),
					);
					return;
				}
			}

			const durationMs = Date.now() - start;
			log.codex.info(
				{
					tokensIn: streamState.inputTokens ?? 0,
					tokensOut: streamState.outputTokens ?? 0,
					durationMs,
					provider: "codex",
				},
				"request complete",
			);

			resolve({
				text,
				structuredOutput,
				durationMs,
				inputTokens: streamState.inputTokens,
				outputTokens: streamState.outputTokens,
			});
		});
	});
}
