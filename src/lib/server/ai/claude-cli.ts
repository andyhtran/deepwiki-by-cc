import { type ChildProcess, execSync, spawn as nodeSpawn } from "node:child_process";
import { log } from "../logger.js";

// Track active claude child processes so they can be killed on cancellation.
const activeProcesses = new Set<ChildProcess>();

/** Kill all currently running claude child processes (used for job cancellation). */
export function killActiveClaudeProcesses(): void {
	for (const proc of activeProcesses) {
		proc.kill();
	}
}

interface ClaudeCliOptions {
	prompt: string;
	systemPrompt?: string;
	model?: string;
	timeoutMs?: number;
	jsonSchema?: Record<string, unknown>;
}

interface ClaudeCliResult {
	text: string;
	structuredOutput?: unknown;
	costUsd?: number;
	durationMs?: number;
	inputTokens?: number;
	outputTokens?: number;
}

interface ClaudeStreamEvent {
	type: string;
	subtype?: string;
	session_id?: string;
	message?: {
		content: { type: string; text?: string }[];
		usage?: {
			input_tokens?: number;
			output_tokens?: number;
			cache_creation_input_tokens?: number;
			cache_read_input_tokens?: number;
		};
	};
	result?: string;
	structured_output?: unknown;
	total_cost_usd?: number;
	duration_api_ms?: number;
	is_error?: boolean;
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
		cache_creation_input_tokens?: number;
		cache_read_input_tokens?: number;
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkClaudeInstalled(): void {
	try {
		execSync("claude --version", { timeout: 5000, stdio: "pipe" });
	} catch {
		throw new Error(
			"Claude CLI is not installed or not in PATH. Install it from https://docs.anthropic.com/en/docs/claude-code",
		);
	}
}

let _checked = false;

export async function invokeClaudeCli(
	options: ClaudeCliOptions,
	maxRetries = 3,
): Promise<ClaudeCliResult> {
	if (!_checked) {
		checkClaudeInstalled();
		_checked = true;
	}

	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await spawnClaude(options);
		} catch (error: unknown) {
			lastError = error instanceof Error ? error : new Error(String(error));

			const isRetryable =
				lastError.message.includes("rate limit") ||
				lastError.message.includes("overloaded") ||
				lastError.message.includes("SIGTERM") ||
				lastError.message.includes("exit code");

			if (attempt < maxRetries && isRetryable) {
				const delay = 2 ** attempt * 2000;
				log.cli.warn(
					{
						attempt: attempt + 1,
						maxAttempts: maxRetries + 1,
						delayMs: delay,
						err: lastError.message,
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

async function spawnClaude(options: ClaudeCliOptions): Promise<ClaudeCliResult> {
	const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;

	const args = [
		"-p",
		options.prompt,
		"--output-format",
		"stream-json",
		"--verbose",
		"--no-session-persistence",
		"--dangerously-skip-permissions",
	];

	if (options.model) {
		args.push("--model", options.model);
	}

	if (options.systemPrompt) {
		args.push("--system-prompt", options.systemPrompt);
	}

	if (options.jsonSchema) {
		args.push("--json-schema", JSON.stringify(options.jsonSchema));
	}

	const model = options.model || "default";
	const promptLen = options.prompt.length;
	log.cli.info({ model, promptChars: promptLen }, "spawning claude");

	const env = { ...process.env };
	delete env.CLAUDECODE;

	return new Promise<ClaudeCliResult>((resolve, reject) => {
		const proc = nodeSpawn("claude", args, {
			stdio: ["ignore", "pipe", "pipe"],
			env,
		});
		activeProcesses.add(proc);

		const timeoutId = setTimeout(() => {
			proc.kill();
			reject(new Error("Claude CLI timed out"));
		}, timeoutMs);

		let textParts: string[] = [];
		let structuredOutput: unknown | undefined;
		let costUsd: number | undefined;
		let durationMs: number | undefined;
		let inputTokens: number | undefined;
		let outputTokens: number | undefined;
		let isError = false;
		let errorResult: string | undefined;
		let buffer = "";
		const stderrChunks: Buffer[] = [];

		proc.stdout.on("data", (chunk: Buffer) => {
			buffer += chunk.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;

				let event: ClaudeStreamEvent;
				try {
					event = JSON.parse(trimmed);
				} catch {
					continue;
				}

				if (event.type === "assistant" && event.message?.content) {
					for (const block of event.message.content) {
						if (block.type === "text" && block.text) {
							textParts.push(block.text);
						}
					}
					if (event.message.usage) {
						inputTokens = event.message.usage.input_tokens;
						outputTokens = event.message.usage.output_tokens;
					}
				}

				if (event.type === "result") {
					if (event.result) {
						textParts = [event.result];
					}
					if (event.structured_output !== undefined) {
						structuredOutput = event.structured_output;
					}
					costUsd = event.total_cost_usd;
					durationMs = event.duration_api_ms;
					isError = event.is_error === true;
					if (isError) {
						errorResult = event.result;
					}
					if (event.usage) {
						inputTokens = event.usage.input_tokens;
						outputTokens = event.usage.output_tokens;
					}
				}
			}
		});

		proc.stderr.on("data", (chunk: Buffer) => {
			stderrChunks.push(chunk);
		});

		proc.on("error", (err) => {
			clearTimeout(timeoutId);
			activeProcesses.delete(proc);
			reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
		});

		proc.on("close", (exitCode) => {
			clearTimeout(timeoutId);
			activeProcesses.delete(proc);
			const stderr = Buffer.concat(stderrChunks).toString();

			if (exitCode !== 0) {
				reject(
					new Error(
						`Claude CLI exit code ${exitCode}: ${stderr || errorResult || "unknown error"}`,
					),
				);
				return;
			}

			if (isError) {
				reject(new Error(`Claude CLI error: ${errorResult || "unknown error"}`));
				return;
			}

			const text = textParts.join("");
			if (!text && !structuredOutput) {
				reject(new Error("Claude CLI returned empty response"));
				return;
			}

			const tokensIn = inputTokens ?? 0;
			const tokensOut = outputTokens ?? 0;
			log.cli.info({ tokensIn, tokensOut, durationMs, costUsd }, "request complete");

			resolve({ text, structuredOutput, costUsd, durationMs, inputTokens, outputTokens });
		});
	});
}
