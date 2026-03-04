<script lang="ts">
let {
	jobId,
	repoName = "",
	onComplete = () => {},
}: { jobId: number; repoName?: string; onComplete?: () => void } = $props();
let progress = $state(0);
let message = $state("Starting...");
let status = $state("pending");
let error = $state("");

$effect(() => {
	if (!jobId) return;

	const eventSource = new EventSource(`/api/jobs/${jobId}`);

	eventSource.onmessage = (event) => {
		try {
			const data = JSON.parse(event.data);
			progress = Math.max(0, data.progress || 0);
			message = data.message || "";
			status = data.status || "processing";

			if (data.status === "completed") {
				eventSource.close();
				onComplete();
			} else if (data.status === "failed") {
				eventSource.close();
				error = data.message || "Job failed";
			}
		} catch {
			// Ignore parse errors
		}
	};

	eventSource.onerror = () => {
		eventSource.close();
		if (status !== "completed" && status !== "failed") {
			error = "Lost connection to job. Refresh to check status.";
		}
	};

	return () => {
		eventSource.close();
	};
});
</script>

<div class="progress-container">
	{#if error}
		<div class="error-box">
			<p class="error-message">{error}</p>
			<button onclick={() => window.location.reload()}>Retry</button>
		</div>
	{:else}
		<div class="job-header">
			{#if repoName}
				<span class="repo-name">{repoName}</span>
			{/if}
			{#if status === "pending"}
				<span class="status-badge queued">Queued</span>
			{:else}
				<span class="status-badge active">Generating</span>
			{/if}
		</div>
		<div class="progress-info">
			<span class="message">{status === "pending" ? "Waiting for other jobs to finish..." : message}</span>
			{#if status !== "pending"}
				<span class="percentage">{progress}%</span>
			{/if}
		</div>
		<div class="progress-bar">
			<div
				class="progress-fill"
				class:indeterminate={status === "pending"}
				style="width: {status === 'pending' ? '100' : progress}%"
			></div>
		</div>
	{/if}
</div>

<style>
	.progress-container {
		padding: 1.5rem;
		background: var(--color-bg-subtle);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
	}

	.job-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.repo-name {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-fg-emphasis);
	}

	.status-badge {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
	}

	.status-badge.active {
		background: var(--color-success-subtle);
		color: var(--color-success-fg);
	}

	.status-badge.queued {
		background: var(--color-attention-subtle);
		color: var(--color-attention-fg);
	}

	.progress-info {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.message {
		font-size: 0.9rem;
		color: var(--color-fg-muted);
	}

	.percentage {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-accent-fg);
	}

	.progress-bar {
		height: 8px;
		background: var(--color-bg-muted);
		border-radius: 4px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: var(--color-success-emphasis);
		border-radius: 4px;
		transition: width 0.3s ease;
	}

	.progress-fill.indeterminate {
		background: var(--color-attention-emphasis);
		opacity: 0.4;
		animation: pulse 2s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 0.2; }
		50% { opacity: 0.5; }
	}

	.error-box {
		text-align: center;
	}

	.error-message {
		color: var(--color-danger-fg);
		margin-bottom: 1rem;
	}

	.error-box button {
		padding: 0.5rem 1rem;
		background: var(--color-bg-muted);
		color: var(--color-fg-default);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		cursor: pointer;
	}

	.error-box button:hover {
		background: var(--color-border-default);
	}
</style>
