import { createHash } from "node:crypto";

export interface EmbeddingClientConfig {
	baseUrl: string;
	apiKey: string;
	model: string;
	timeoutMs: number;
}

export function normalizeEmbeddingBaseUrl(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/\/+$/, "");
	if (trimmed.length === 0) {
		throw new Error("Embeddings endpoint is empty");
	}
	return trimmed;
}

export function buildEmbeddingsEndpoint(baseUrl: string): string {
	const normalized = normalizeEmbeddingBaseUrl(baseUrl);
	if (normalized.endsWith("/embeddings")) {
		return normalized;
	}
	if (normalized.endsWith("/v1")) {
		return `${normalized}/embeddings`;
	}
	return `${normalized}/v1/embeddings`;
}

export function createEndpointFingerprint(baseUrl: string): string {
	const normalized = normalizeEmbeddingBaseUrl(baseUrl);
	let canonical = normalized;
	if (canonical.endsWith("/v1/embeddings")) {
		canonical = canonical.slice(0, -"/v1/embeddings".length);
	} else if (canonical.endsWith("/v1")) {
		canonical = canonical.slice(0, -"/v1".length);
	}
	return createHash("sha256").update(canonical).digest("hex");
}

function extractErrorMessage(payload: unknown): string | null {
	if (!payload || typeof payload !== "object") return null;
	if ("error" in payload) {
		const err = (payload as { error?: unknown }).error;
		if (typeof err === "string") return err;
		if (err && typeof err === "object" && "message" in err) {
			const msg = (err as { message?: unknown }).message;
			if (typeof msg === "string") return msg;
		}
	}
	return null;
}

function parseEmbeddingResponse(
	payload: unknown,
	expectedCount: number,
): { embeddings: number[][]; model: string } {
	if (!payload || typeof payload !== "object") {
		throw new Error("Embeddings response is not a JSON object");
	}

	const data = (payload as { data?: unknown }).data;
	const model = (payload as { model?: unknown }).model;
	if (!Array.isArray(data)) {
		throw new Error("Embeddings response is missing data[]");
	}
	if (typeof model !== "string" || model.length === 0) {
		throw new Error("Embeddings response is missing model");
	}

	const byIndex = new Map<number, number[]>();
	for (const row of data) {
		if (!row || typeof row !== "object") continue;
		const index = (row as { index?: unknown }).index;
		const embedding = (row as { embedding?: unknown }).embedding;
		if (typeof index !== "number" || !Number.isInteger(index)) continue;
		if (!Array.isArray(embedding) || embedding.some((v) => typeof v !== "number")) continue;
		byIndex.set(index, embedding);
	}

	const embeddings: number[][] = [];
	for (let i = 0; i < expectedCount; i++) {
		const vector = byIndex.get(i);
		if (!vector) {
			throw new Error(`Embeddings response is missing vector for input index ${i}`);
		}
		embeddings.push(vector);
	}

	return { embeddings, model };
}

export async function createEmbeddings(
	inputs: string[],
	client: EmbeddingClientConfig,
): Promise<{ embeddings: number[][]; providerModel: string }> {
	if (inputs.length === 0) return { embeddings: [], providerModel: client.model };

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), client.timeoutMs);

	try {
		const endpoint = buildEmbeddingsEndpoint(client.baseUrl);
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (client.apiKey.trim().length > 0) {
			headers.Authorization = `Bearer ${client.apiKey}`;
		}

		const response = await fetch(endpoint, {
			method: "POST",
			headers,
			body: JSON.stringify({
				model: client.model,
				input: inputs,
			}),
			signal: controller.signal,
		});

		let body: unknown = null;
		try {
			body = await response.json();
		} catch {
			body = null;
		}

		if (!response.ok) {
			const msg = extractErrorMessage(body);
			throw new Error(
				`Embeddings request failed (${response.status}): ${msg || response.statusText || "unknown error"}`,
			);
		}

		const parsed = parseEmbeddingResponse(body, inputs.length);
		return { embeddings: parsed.embeddings, providerModel: parsed.model };
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw new Error(`Embeddings request timed out after ${client.timeoutMs}ms`);
		}
		throw error instanceof Error ? error : new Error(String(error));
	} finally {
		clearTimeout(timeout);
	}
}
