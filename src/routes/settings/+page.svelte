<script lang="ts">
const { data } = $props();
const { defaults, generationModels } = data;
const { generationModel: initModel, parallelPageLimit: initLimit } = data.current;

let generationModel = $state(initModel);
let parallelPageLimit = $state(initLimit);
let displayOwner = $state(data.current.display.showRepoOwner);
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
		const payload: Record<string, string | number | boolean> = {
			generationModel,
			parallelPageLimit,
			showRepoOwner: displayOwner,
		};

		const res = await fetch("/api/settings", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		if (res.ok) {
			message = "Settings saved";
			setTimeout(() => {
				message = "";
			}, 3000);
		} else {
			error = `Failed to save (${await parseErrorResponse(res)})`;
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
	displayOwner = defaults.display.showRepoOwner;
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

	<div class="section">
		<h2>Display</h2>
		<p class="description">Controls how repository names are shown in the app.</p>

		<label class="checkbox-row">
			<input type="checkbox" bind:checked={displayOwner} />
			<span>Show repository owner</span>
		</label>
	</div>

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
