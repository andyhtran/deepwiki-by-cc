<script lang="ts">
import JobProgress from "$lib/components/JobProgress.svelte";
import RepoInput from "$lib/components/RepoInput.svelte";
import type { PageData } from "./$types.js";

interface WikiItem {
	id: number;
	owner: string;
	repo_name: string;
	status: string;
	page_count: number;
	model: string;
	source_type: string;
	generation_duration_ms: number | null;
	total_tokens: number | null;
	total_cost: number | null;
	created_at: string;
}

interface ActiveJob {
	id: number;
	repoName: string;
}

let { data }: { data: PageData } = $props();

let activeJobs: ActiveJob[] = $state(
	data.activeJobs.map((j) => ({ id: j.id, repoName: j.repo_name })),
);
let wikis: WikiItem[] = $state(data.wikis as WikiItem[]);

function handleGenerate(jobId: number, repoName: string) {
	if (!activeJobs.find((j) => j.id === jobId)) {
		activeJobs = [...activeJobs, { id: jobId, repoName }];
	}
}

function handleJobComplete(jobId: number) {
	activeJobs = activeJobs.filter((j) => j.id !== jobId);
	loadWikis();
}

async function loadWikis() {
	try {
		const res = await fetch("/api/wikis");
		if (res.ok) {
			wikis = await res.json();
		}
	} catch {
		// Ignore
	}
}

async function deleteWiki(id: number, name: string) {
	if (!confirm(`Delete wiki "${name}"?`)) return;

	try {
		await fetch(`/api/wikis/by-id/${id}`, { method: "DELETE" });
		await loadWikis();
	} catch {
		// Ignore
	}
}

function getWikiLink(wiki: WikiItem): string {
	return `/${wiki.owner}/${wiki.repo_name}?v=${wiki.id}`;
}

function getWikiDisplayName(wiki: WikiItem): string {
	return `${wiki.owner}/${wiki.repo_name}`;
}

function getSourceBadge(type: string): { label: string; cls: string } {
	switch (type) {
		case "local":
			return { label: "Local", cls: "local" };
		default:
			return { label: "GitHub", cls: "github" };
	}
}

function formatTokens(n: number | null): string {
	if (!n) return "";
	if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
	return String(n);
}

function formatDuration(ms: number | null): string {
	if (!ms) return "";
	if (ms < 60000) return `${Math.round(ms / 1000)}s`;
	return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function shortenModel(model: string): string {
	if (model.includes("opus-4-6")) return "opus-4.6";
	if (model.includes("sonnet-4-6")) return "sonnet-4.6";
	return model;
}
</script>

<div class="home">
	<div class="hero">
		<h1>DeepWiki</h1>
		<p>Generate AI-powered documentation for any GitHub repository or local project.</p>
		<RepoInput onSubmit={handleGenerate} />
	</div>

	{#if activeJobs.length > 0}
		<div class="job-section">
			<h2>Generation Progress</h2>
			<div class="job-list">
				{#each activeJobs as job (job.id)}
					<JobProgress
						jobId={job.id}
						repoName={job.repoName}
						onComplete={() => handleJobComplete(job.id)}
					/>
				{/each}
			</div>
		</div>
	{/if}

	<div class="wikis-section">
		<div class="section-header">
			<h2>Generated Wikis</h2>
		</div>
		{#if wikis.length === 0}
			<p class="muted">No wikis generated yet. Enter a repository URL above to get started.</p>
		{:else}
			<div class="wiki-list">
				{#each wikis as wiki}
					<div class="wiki-card">
						<div class="wiki-info">
							<div class="wiki-title-row">
								<span class="source-badge {getSourceBadge(wiki.source_type).cls}">
									{getSourceBadge(wiki.source_type).label}
								</span>
								<a href={getWikiLink(wiki)} class="wiki-name">
									{getWikiDisplayName(wiki)}
								</a>
							</div>
							<div class="wiki-meta">
								<span class="status" class:completed={wiki.status === 'completed'} class:failed={wiki.status === 'failed'} class:generating={wiki.status === 'generating'}>
									{wiki.status}
								</span>
								<span>{wiki.page_count} pages</span>
								{#if wiki.model}
									<span>{shortenModel(wiki.model)}</span>
								{/if}
								{#if wiki.total_tokens}
									<span>{formatTokens(wiki.total_tokens)} tokens</span>
								{/if}
								{#if wiki.total_cost}
									<span>${wiki.total_cost.toFixed(2)}</span>
								{/if}
								{#if wiki.generation_duration_ms}
									<span>{formatDuration(wiki.generation_duration_ms)}</span>
								{/if}
								<span class="date">{new Date(wiki.created_at).toLocaleDateString()}</span>
							</div>
						</div>
						<button class="delete-btn" onclick={() => deleteWiki(wiki.id, getWikiDisplayName(wiki))}>
							Delete
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.home {
		max-width: 800px;
		margin: 0 auto;
	}

	.hero {
		text-align: center;
		padding: 3rem 0;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.hero h1 {
		font-size: 2.5rem;
		color: var(--color-fg-emphasis);
		margin-bottom: 0.5rem;
	}

	.hero p {
		color: var(--color-fg-muted);
		margin-bottom: 2rem;
		font-size: 1.1rem;
	}

	.job-section {
		margin-bottom: 2rem;
	}

	.job-section h2 {
		font-size: 1.25rem;
		color: var(--color-fg-emphasis);
		margin-bottom: 1rem;
	}

	.job-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}

	.section-header h2 {
		font-size: 1.25rem;
		color: var(--color-fg-emphasis);
	}

	.muted {
		color: var(--color-fg-subtle);
	}

	.wiki-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.wiki-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		background: var(--color-bg-subtle);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
	}

	.wiki-title-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.source-badge {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		white-space: nowrap;
	}

	.source-badge.github {
		background: var(--color-success-subtle);
		color: var(--color-success-fg);
	}

	.source-badge.local {
		background: var(--color-accent-subtle);
		color: var(--color-accent-fg);
	}

	.wiki-name {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-accent-fg);
	}

	.wiki-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 0.25rem;
		font-size: 0.8rem;
		color: var(--color-fg-subtle);
	}

	.status {
		padding: 0.1rem 0.5rem;
		border-radius: 10px;
		font-size: 0.75rem;
	}

	.status.completed {
		background: var(--color-success-subtle);
		color: var(--color-success-fg);
	}

	.status.failed {
		background: var(--color-danger-subtle);
		color: var(--color-danger-fg);
	}

	.status.generating {
		background: var(--color-accent-subtle);
		color: var(--color-accent-fg);
	}

	.date {
		color: var(--color-fg-subtle);
	}

	.delete-btn {
		padding: 0.375rem 0.75rem;
		background: none;
		color: var(--color-fg-subtle);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		font-size: 0.8rem;
		cursor: pointer;
	}

	.delete-btn:hover {
		color: var(--color-danger-fg);
		border-color: var(--color-danger-fg);
	}
</style>
