<script lang="ts">
let { onSubmit }: { onSubmit?: (jobId: number, repoName: string) => void } = $props();
let repoUrl = $state("");
let loading = $state(false);
let error = $state("");

async function handleSubmit() {
	if (!repoUrl.trim()) return;
	error = "";
	loading = true;

	try {
		const res = await fetch("/api/generate", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ repoUrl: repoUrl.trim() }),
		});

		const data = await res.json();

		if (!res.ok) {
			error = data.error || "Failed to start generation";
			return;
		}

		onSubmit?.(data.jobId, data.repoName);
	} catch (err) {
		error = "Network error. Please try again.";
	} finally {
		loading = false;
	}
}
</script>

<form onsubmit={e => { e.preventDefault(); handleSubmit(); }}>
	<div class="input-group">
		<input
			type="text"
			bind:value={repoUrl}
			placeholder="https://github.com/owner/repo or /path/to/local/repo"
			disabled={loading}
		/>
		<button type="submit" disabled={loading || !repoUrl.trim()}>
			{loading ? 'Starting...' : 'Generate Wiki'}
		</button>
	</div>
	<p class="hint">Supports GitHub URLs, owner/repo shorthand, or local file paths</p>

	{#if error}
		<p class="error">{error}</p>
	{/if}
</form>

<style>
	form {
		width: 100%;
		max-width: 600px;
	}

	.input-group {
		display: flex;
		gap: 0.5rem;
	}

	input {
		flex: 1;
		padding: 0.75rem 1rem;
		background: var(--color-bg-default);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		color: var(--color-fg-default);
		font-size: 0.95rem;
	}

	input:focus {
		outline: none;
		border-color: var(--color-accent-fg);
		box-shadow: 0 0 0 3px var(--color-accent-shadow);
	}

	input::placeholder {
		color: var(--color-fg-subtle);
	}

	button[type="submit"] {
		padding: 0.75rem 1.5rem;
		background: var(--color-success-emphasis);
		color: #fff;
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		font-size: 0.95rem;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
	}

	button[type="submit"]:hover:not(:disabled) {
		background: var(--color-success-hover);
	}

	.hint {
		margin-top: 0.375rem;
		color: var(--color-fg-subtle);
		font-size: 0.75rem;
	}

	.error {
		margin-top: 0.5rem;
		color: var(--color-danger-fg);
		font-size: 0.85rem;
	}
</style>
