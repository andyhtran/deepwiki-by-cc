<script lang="ts">
const { data } = $props();
const { defaults, defaultModels } = data;
const { generationModel: initModel, parallelPageLimit: initLimit } = data.current;

let generationModel = $state(initModel);
let parallelPageLimit = $state(initLimit);
let saving = $state(false);
let message = $state("");

async function save() {
	saving = true;
	message = "";

	try {
		const payload: Record<string, string | number> = { generationModel, parallelPageLimit };

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
			message = "Failed to save";
		}
	} catch {
		message = "Network error";
	} finally {
		saving = false;
	}
}

function reset() {
	generationModel = defaults.generationModel;
	parallelPageLimit = defaults.parallelPageLimit;
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
			{#each defaultModels as model}
				<option value={model.id}>{model.name} — ${model.input}/${model.output} per M tokens</option>
			{/each}
		</select>
	</div>

	<div class="section">
		<h2>Concurrent CLI Processes</h2>
		<p class="description">Number of Claude CLI processes to run in parallel during page generation (1–5).</p>

		<input
			class="number-input"
			type="number"
			min="1"
			max="5"
			bind:value={parallelPageLimit}
		/>
	</div>

	<div class="actions">
		<button class="save-btn" onclick={save} disabled={saving}>
			{saving ? 'Saving...' : 'Save'}
		</button>
		<button class="reset-btn" onclick={reset}>Reset to defaults</button>
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
		width: 80px;
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

	.actions {
		display: flex;
		align-items: center;
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
</style>
