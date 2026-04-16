<script lang="ts">
const { data } = $props();
const { defaults, generationModels } = data;
const {
	generationModel: initModel,
	parallelPageLimit: initLimit,
	embeddings: initEmbeddings,
	retrieval: initRetrieval,
} = data.current;

let generationModel = $state(initModel);
let parallelPageLimit = $state(initLimit);
let embeddingsEnabled = $state(initEmbeddings.enabled);

// Retrieval mode state
let retrievalModeGeneration = $state(initRetrieval.generation.mode);
let retrievalModeMcp = $state(initRetrieval.mcp.mode);
let mcpTopK = $state(initRetrieval.mcp.topK);
let mcpMaxContextChars = $state(initRetrieval.mcp.maxContextChars);
let weaknessMinChunks = $state(initRetrieval.weakness.minChunks);
let weaknessMinContextChars = $state(initRetrieval.weakness.minContextChars);
let weaknessMinTopScore = $state(initRetrieval.weakness.minTopScore);
let weaknessMinScoreGap = $state(initRetrieval.weakness.minScoreGap);
let embeddingBaseUrl = $state(initEmbeddings.baseUrl);
let embeddingApiKey = $state(initEmbeddings.apiKey);
let embeddingModel = $state(initEmbeddings.model);
let embeddingTopK = $state(initEmbeddings.topK);
let embeddingMaxContextChars = $state(initEmbeddings.maxContextChars);
let embeddingTimeoutMs = $state(initEmbeddings.timeoutMs);
let embeddingChunkSize = $state(initEmbeddings.chunkSize);
let embeddingChunkOverlap = $state(initEmbeddings.chunkOverlap);
let embeddingBatchSize = $state(initEmbeddings.batchSize);
let saving = $state(false);
let message = $state("");
let error = $state("");

async function parseErrorResponse(res: Response): Promise<string> {
	try {
		const payload = (await res.json()) as {
			error?: unknown;
			issues?: Array<{ path?: unknown; message?: unknown }>;
		};
		if (typeof payload.error === "string") {
			if (Array.isArray(payload.issues) && payload.issues.length > 0) {
				const details = payload.issues
					.map((issue) => `${String(issue.path || "field")}: ${String(issue.message || "invalid")}`)
					.join(", ");
				return `${payload.error} (${details})`;
			}
			return payload.error;
		}
	} catch {
		// Ignore JSON parse failures and fall back to status text.
	}
	return `${res.status} ${res.statusText}`.trim();
}

async function save() {
	saving = true;
	message = "";
	error = "";

	try {
		const normalizedBaseUrl = embeddingBaseUrl.trim();
		const normalizedModel = embeddingModel.trim();
		if (normalizedBaseUrl.length === 0) {
			error = "Embedding endpoint URL is required.";
			return;
		}
		if (normalizedModel.length === 0) {
			error = "Embedding model is required.";
			return;
		}
		if (embeddingChunkOverlap >= embeddingChunkSize) {
			error = "Chunk overlap must be less than chunk size.";
			return;
		}

		const generalPayload: Record<string, string | number> = { generationModel, parallelPageLimit };
		const embeddingPayload = {
			enabled: embeddingsEnabled,
			baseUrl: normalizedBaseUrl,
			apiKey: embeddingApiKey,
			model: normalizedModel,
			topK: Number(embeddingTopK),
			maxContextChars: Number(embeddingMaxContextChars),
			timeoutMs: Number(embeddingTimeoutMs),
			chunkSize: Number(embeddingChunkSize),
			chunkOverlap: Number(embeddingChunkOverlap),
			batchSize: Number(embeddingBatchSize),
			retrievalModeGeneration,
			retrievalModeMcp,
			mcpTopK: Number(mcpTopK),
			mcpMaxContextChars: Number(mcpMaxContextChars),
			weaknessMinChunks: Number(weaknessMinChunks),
			weaknessMinContextChars: Number(weaknessMinContextChars),
			weaknessMinTopScore: Number(weaknessMinTopScore),
			weaknessMinScoreGap: Number(weaknessMinScoreGap),
		};

		const [generalRes, embeddingRes] = await Promise.all([
			fetch("/api/settings", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(generalPayload),
			}),
			fetch("/api/settings/embeddings", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(embeddingPayload),
			}),
		]);

		if (generalRes.ok && embeddingRes.ok) {
			message = "Settings saved";
			setTimeout(() => {
				message = "";
			}, 3000);
		} else {
			const failures: string[] = [];
			if (!generalRes.ok) {
				failures.push(`general settings: ${await parseErrorResponse(generalRes)}`);
			}
			if (!embeddingRes.ok) {
				failures.push(`embedding settings: ${await parseErrorResponse(embeddingRes)}`);
			}
			error = `Failed to save (${failures.join("; ")})`;
		}
	} catch {
		error = "Network error";
	} finally {
		saving = false;
	}
}

function reset() {
	generationModel = defaults.generationModel;
	parallelPageLimit = defaults.parallelPageLimit;
	embeddingsEnabled = defaults.embeddings.enabled;
	embeddingBaseUrl = defaults.embeddings.baseUrl;
	embeddingApiKey = defaults.embeddings.apiKey;
	embeddingModel = defaults.embeddings.model;
	embeddingTopK = defaults.embeddings.topK;
	embeddingMaxContextChars = defaults.embeddings.maxContextChars;
	embeddingTimeoutMs = defaults.embeddings.timeoutMs;
	embeddingChunkSize = defaults.embeddings.chunkSize;
	embeddingChunkOverlap = defaults.embeddings.chunkOverlap;
	embeddingBatchSize = defaults.embeddings.batchSize;
	retrievalModeGeneration = defaults.retrieval.generation.mode;
	retrievalModeMcp = defaults.retrieval.mcp.mode;
	mcpTopK = defaults.retrieval.mcp.topK;
	mcpMaxContextChars = defaults.retrieval.mcp.maxContextChars;
	weaknessMinChunks = defaults.retrieval.weakness.minChunks;
	weaknessMinContextChars = defaults.retrieval.weakness.minContextChars;
	weaknessMinTopScore = defaults.retrieval.weakness.minTopScore;
	weaknessMinScoreGap = defaults.retrieval.weakness.minScoreGap;
	error = "";
}
</script>

<svelte:head>
	<title>Settings - DeepWiki</title>
</svelte:head>

<div class="settings">
	<h1>Settings</h1>

	<div class="section">
		<h2>Default Model</h2>
		<p class="description">The model used for all wiki generation.</p>

		<select class="model-select" bind:value={generationModel}>
			{#each generationModels as model}
				{#if model.input !== null && model.output !== null}
					<option value={model.id}>{model.name} — ${model.input}/${model.output} per M tokens</option>
				{:else}
					<option value={model.id}>{model.name}</option>
				{/if}
			{/each}
		</select>
	</div>

	<div class="section">
		<h2>Concurrent CLI Processes</h2>
		<p class="description">Number of generation CLI processes to run in parallel during page generation (1–5).</p>

		<input
			class="number-input"
			type="number"
			min="1"
			max="5"
			bind:value={parallelPageLimit}
		/>
	</div>

	<details class="section advanced-config">
		<summary>Advanced: Embeddings Retrieval (Optional)</summary>
		<p class="description">
			Use an OpenAI-compatible embeddings endpoint for semantic context retrieval during wiki generation.
		</p>

			<label class="checkbox-row">
				<input type="checkbox" bind:checked={embeddingsEnabled} />
				<span>Enable embeddings retrieval</span>
			</label>

			<div class="field-grid">
				<label class="field">
					<span>Embedding endpoint URL</span>
					<input
						class="text-input"
						type="url"
						bind:value={embeddingBaseUrl}
						placeholder="https://api.openai.com/v1/embeddings"
					/>
				</label>
				<label class="field">
					<span>Model</span>
					<input class="text-input" type="text" bind:value={embeddingModel} placeholder="text-embedding-3-small" />
				</label>
				<label class="field">
					<span>API key (optional)</span>
					<input class="text-input" type="password" bind:value={embeddingApiKey} autocomplete="off" />
				</label>
			</div>

			<details class="advanced">
				<summary>Advanced retrieval and chunking controls</summary>
				<div class="field-grid advanced-fields">
					<label class="field">
						<span>Top K chunks (generation)</span>
						<input class="number-input" type="number" min="1" max="30" bind:value={embeddingTopK} />
					</label>
					<label class="field">
						<span>Max context chars (generation)</span>
						<input
							class="number-input"
							type="number"
							min="1000"
							max="200000"
							bind:value={embeddingMaxContextChars}
						/>
					</label>
					<label class="field">
						<span>Timeout (ms)</span>
						<input class="number-input" type="number" min="1000" max="120000" bind:value={embeddingTimeoutMs} />
				</label>
				<label class="field">
					<span>Chunk size</span>
					<input class="number-input" type="number" min="200" max="8000" bind:value={embeddingChunkSize} />
				</label>
				<label class="field">
					<span>Chunk overlap</span>
					<input class="number-input" type="number" min="0" max="2000" bind:value={embeddingChunkOverlap} />
				</label>
				<label class="field">
					<span>Batch size</span>
					<input class="number-input" type="number" min="1" max="128" bind:value={embeddingBatchSize} />
				</label>
			</div>
		</details>

		<details class="advanced">
			<summary>Retrieval modes and MCP settings</summary>
			<div class="field-grid advanced-fields">
				<label class="field">
					<span>Generation retrieval mode</span>
					<select class="model-select" bind:value={retrievalModeGeneration}>
						<option value="constrained">Constrained (file-scoped)</option>
						<option value="hybrid_auto">Hybrid auto (fallback to global)</option>
					</select>
				</label>
				<label class="field">
					<span>MCP/chat retrieval mode</span>
					<select class="model-select" bind:value={retrievalModeMcp}>
						<option value="constrained">Constrained (file-scoped)</option>
						<option value="hybrid_auto">Hybrid auto (fallback to global)</option>
					</select>
				</label>
				<label class="field">
					<span>MCP Top K chunks</span>
					<input class="number-input" type="number" min="1" max="50" bind:value={mcpTopK} />
				</label>
				<label class="field">
					<span>MCP Max context chars</span>
					<input class="number-input" type="number" min="1000" max="500000" bind:value={mcpMaxContextChars} />
				</label>
			</div>
			<details class="advanced">
				<summary>Weakness detection thresholds</summary>
				<div class="field-grid advanced-fields">
					<label class="field">
						<span>Min chunks</span>
						<input class="number-input" type="number" min="1" max="20" bind:value={weaknessMinChunks} />
					</label>
					<label class="field">
						<span>Min context chars</span>
						<input class="number-input" type="number" min="500" max="50000" bind:value={weaknessMinContextChars} />
					</label>
					<label class="field">
						<span>Min top score</span>
						<input class="number-input" type="number" min="0" max="1" step="0.05" bind:value={weaknessMinTopScore} />
					</label>
					<label class="field">
						<span>Min score gap</span>
						<input class="number-input" type="number" min="0" max="1" step="0.01" bind:value={weaknessMinScoreGap} />
					</label>
				</div>
			</details>
		</details>
	</details>

	<div class="actions">
		<button class="save-btn" onclick={save} disabled={saving}>
			{saving ? 'Saving...' : 'Save'}
		</button>
		<button class="reset-btn" onclick={reset}>Reset to defaults</button>
		{#if error}
			<span class="message error">{error}</span>
		{/if}
		{#if message}
			<span class="message">{message}</span>
		{/if}
	</div>
</div>

<style>
	.settings {
		max-width: 600px;
		margin: 0 auto;
	}

	h1 {
		font-size: 1.75rem;
		color: var(--color-fg-emphasis);
		margin-bottom: 1.5rem;
	}

	.section {
		margin-bottom: 1.5rem;
	}

	h2 {
		font-size: 1.1rem;
		color: var(--color-fg-emphasis);
		margin-bottom: 0.25rem;
	}

	.description {
		color: var(--color-fg-muted);
		font-size: 0.85rem;
		margin-bottom: 0.75rem;
	}

	.number-input {
		width: 100%;
		padding: 0.625rem 0.75rem;
		background: var(--color-bg-subtle);
		color: var(--color-fg-default);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		font-size: 0.9rem;
	}

	.number-input:hover {
		border-color: var(--color-fg-subtle);
	}

	.number-input:focus {
		outline: none;
		border-color: var(--color-accent-fg);
		box-shadow: 0 0 0 2px var(--color-accent-subtle);
	}

	.model-select {
		width: 100%;
		padding: 0.625rem 0.75rem;
		background: var(--color-bg-subtle);
		color: var(--color-fg-default);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		font-size: 0.9rem;
		cursor: pointer;
		appearance: auto;
	}

	.model-select:hover {
		border-color: var(--color-fg-subtle);
	}

	.model-select:focus {
		outline: none;
		border-color: var(--color-accent-fg);
		box-shadow: 0 0 0 2px var(--color-accent-subtle);
	}

	.checkbox-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		color: var(--color-fg-default);
	}

	.field-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.75rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.field span {
		font-size: 0.8rem;
		color: var(--color-fg-muted);
	}

	.text-input {
		width: 100%;
		padding: 0.625rem 0.75rem;
		background: var(--color-bg-subtle);
		color: var(--color-fg-default);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		font-size: 0.9rem;
	}

	.text-input:hover {
		border-color: var(--color-fg-subtle);
	}

	.text-input:focus {
		outline: none;
		border-color: var(--color-accent-fg);
		box-shadow: 0 0 0 2px var(--color-accent-subtle);
	}

	.advanced {
		margin-top: 0.75rem;
	}

	.advanced summary {
		cursor: pointer;
		color: var(--color-fg-muted);
		font-size: 0.85rem;
	}

	.advanced-config {
		border: 1px solid var(--color-border-default);
		border-radius: 8px;
		padding: 0.75rem;
		background: var(--color-bg-subtle);
	}

	.advanced-config > summary {
		cursor: pointer;
		color: var(--color-fg-default);
		font-size: 0.95rem;
		font-weight: 600;
	}

	.advanced-config[open] > summary {
		margin-bottom: 0.75rem;
	}

	.advanced-fields {
		margin-top: 0.75rem;
	}

	.actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.save-btn {
		padding: 0.5rem 1.25rem;
		background: var(--color-success-emphasis);
		color: #fff;
		border: none;
		border-radius: 6px;
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
	}

	.save-btn:hover:not(:disabled) {
		background: var(--color-success-hover);
	}

	.reset-btn {
		padding: 0.5rem 1.25rem;
		background: none;
		color: var(--color-fg-muted);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		font-size: 0.9rem;
		cursor: pointer;
	}

	.reset-btn:hover {
		color: var(--color-fg-default);
		border-color: var(--color-fg-subtle);
	}

	.message {
		font-size: 0.85rem;
		color: var(--color-success-fg);
	}

	.message.error {
		color: var(--color-danger-fg, #d1242f);
	}
</style>
