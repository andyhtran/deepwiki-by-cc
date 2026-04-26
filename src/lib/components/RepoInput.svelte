<script lang="ts">
let { onSubmit }: { onSubmit?: (jobId: number, repoName: string) => void } = $props();
let repoUrl = $state("");
let loading = $state(false);
let error = $state("");

// State for the "wiki already exists" confirmation prompt
let pendingExisting: { owner: string; repo: string; version: number; repoName: string } | null =
	$state(null);

async function handleSubmit(force = false) {
	if (!repoUrl.trim()) return;
	error = "";
	pendingExisting = null;
	loading = true;

	try {
		const res = await fetch("/api/generate", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ repoUrl: repoUrl.trim(), force }),
		});

		const data = await res.json();

		if (!res.ok) {
			error = data.error || "Failed to start generation";
			return;
		}

		// Server signals that a completed wiki already exists — prompt the user
		if (data.existingWiki) {
			pendingExisting = {
				owner: data.owner,
				repo: data.repo,
				version: data.version,
				repoName: data.repoName,
			};
			return;
		}

		onSubmit?.(data.jobId, data.repoName);
	} catch (err) {
		error = "Network error. Please try again.";
	} finally {
		loading = false;
	}
}

function viewExisting() {
	if (!pendingExisting) return;
	window.location.href = `/${pendingExisting.owner}/${pendingExisting.repo}?v=${pendingExisting.version}`;
}

function generateNewVersion() {
	handleSubmit(true);
}

function cancelPrompt() {
	pendingExisting = null;
}
</script>

<form onsubmit={e => { e.preventDefault(); handleSubmit(); }}>
	<div class="input-group">
		<input
			id="repo-input"
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

	{#if pendingExisting}
		<div class="existing-prompt">
			<p>A wiki already exists for <strong>{pendingExisting.repoName}</strong>.</p>
			<div class="existing-actions">
				<button type="button" class="btn-view" onclick={viewExisting}>View Existing</button>
				<button type="button" class="btn-generate" onclick={generateNewVersion}>Generate New Version</button>
				<button type="button" class="btn-cancel" onclick={cancelPrompt}>Cancel</button>
			</div>
		</div>
	{/if}

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

	@media (hover: hover) {
		button[type="submit"]:hover:not(:disabled) {
			background: var(--color-success-hover);
		}
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

	.existing-prompt {
		margin-top: 0.75rem;
		padding: 0.75rem 1rem;
		background: var(--color-bg-subtle);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		font-size: 0.9rem;
	}

	.existing-prompt p {
		margin: 0 0 0.5rem;
	}

	.existing-actions {
		display: flex;
		gap: 0.5rem;
	}

	.existing-actions button {
		padding: 0.375rem 0.75rem;
		border-radius: 6px;
		font-size: 0.8rem;
		cursor: pointer;
		border: 1px solid var(--color-border-default);
	}

	.btn-view {
		background: var(--color-accent-subtle);
		color: var(--color-accent-fg);
	}

	.btn-generate {
		background: var(--color-success-subtle);
		color: var(--color-success-fg);
	}

	.btn-cancel {
		background: none;
		color: var(--color-fg-subtle);
	}

	@media (hover: hover) {
		.btn-view:hover {
			background: var(--color-accent-emphasis);
			color: #fff;
		}

		.btn-generate:hover {
			background: var(--color-success-emphasis);
			color: #fff;
		}

		.btn-cancel:hover {
			color: var(--color-fg-default);
		}
	}

	/* Stack the URL input above the green Generate button on mobile so the
	   input has the full row width to itself and the action is clearly
	   below it instead of competing for horizontal space. */
	@media (max-width: 767px) {
		.input-group {
			flex-direction: column;
		}

		button[type="submit"] {
			width: 100%;
		}
	}
</style>
