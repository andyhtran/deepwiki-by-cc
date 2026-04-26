<script lang="ts">
import { onMount } from "svelte";
import JobProgress from "$lib/components/JobProgress.svelte";
import RepoInput from "$lib/components/RepoInput.svelte";
import type { PageData } from "./$types.js";

interface WikiItem {
	id: number;
	repo_id: number | null;
	version: number;
	owner: string | null;
	repo_name: string | null;
	status: string;
	page_count: number;
	model: string;
	source_type: string;
	generation_duration_ms: number | null;
	total_tokens: number | null;
	total_cost: number | null;
	created_at: string;
	updated_at: string;
}

interface DedupedWiki extends WikiItem {
	version_count: number;
}

interface ActiveJob {
	id: number;
	repoName: string;
}

type ViewMode = "grid" | "list";

let { data }: { data: PageData } = $props();

let activeJobs: ActiveJob[] = $state(
	data.activeJobs.map((j) => ({ id: j.id, repoName: j.repo_name })),
);
let wikis: WikiItem[] = $state(data.wikis as WikiItem[]);
let viewMode: ViewMode = $state("grid");
let searchQuery = $state("");

const VIEW_STORAGE_KEY = "deepwiki:home-view";

onMount(() => {
	try {
		const saved = localStorage.getItem(VIEW_STORAGE_KEY);
		if (saved === "list" || saved === "grid") viewMode = saved;
	} catch {
		// localStorage unavailable — keep default
	}
});

function setViewMode(mode: ViewMode) {
	viewMode = mode;
	try {
		localStorage.setItem(VIEW_STORAGE_KEY, mode);
	} catch {
		// Ignore
	}
}

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

function focusRepoInput() {
	const el = document.getElementById("repo-input") as HTMLInputElement | null;
	if (!el) return;
	el.scrollIntoView({ behavior: "smooth", block: "center" });
	// Wait for scroll before focusing so iOS keyboards don't jump.
	setTimeout(() => el.focus(), 250);
}

function getWikiLink(wiki: WikiItem): string {
	return `/${wiki.owner}/${wiki.repo_name}`;
}

function getWikiDisplayName(wiki: WikiItem): string {
	return `${wiki.owner ?? "unknown"}/${wiki.repo_name ?? "unknown"}`;
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

function formatRelativeTime(dateStr: string): string {
	const ts = new Date(dateStr).getTime();
	if (!Number.isFinite(ts)) return "";
	const diff = Date.now() - ts;
	const min = 60_000;
	const hr = 60 * min;
	const day = 24 * hr;
	if (diff < min) return "just now";
	if (diff < hr) return `${Math.round(diff / min)}m ago`;
	if (diff < day) return `${Math.round(diff / hr)}h ago`;
	if (diff < 30 * day) return `${Math.round(diff / day)}d ago`;
	return new Date(dateStr).toLocaleDateString();
}

// Group wikis by underlying repo so the grid shows one tile per repo. The
// source list is already ordered by updated_at DESC, so the first occurrence
// per group is the latest version.
function dedupeByRepo(list: WikiItem[]): DedupedWiki[] {
	const map = new Map<string, DedupedWiki>();
	for (const w of list) {
		const key =
			w.repo_id != null
				? `id:${w.repo_id}`
				: `nm:${w.source_type}:${w.owner ?? ""}/${w.repo_name ?? ""}`;
		const existing = map.get(key);
		if (existing) {
			existing.version_count += 1;
		} else {
			map.set(key, { ...w, version_count: 1 });
		}
	}
	return Array.from(map.values());
}

let dedupedWikis = $derived(dedupeByRepo(wikis));

let filteredGrid = $derived.by(() => {
	const q = searchQuery.trim().toLowerCase();
	if (!q) return dedupedWikis;
	return dedupedWikis.filter((w) =>
		`${w.owner ?? ""}/${w.repo_name ?? ""}`.toLowerCase().includes(q),
	);
});

let filteredList = $derived.by(() => {
	const q = searchQuery.trim().toLowerCase();
	if (!q) return wikis;
	return wikis.filter((w) => `${w.owner ?? ""}/${w.repo_name ?? ""}`.toLowerCase().includes(q));
});
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
			<h2>Repositories</h2>
			{#if wikis.length > 0}
				<div class="section-controls">
					<div class="search-box">
						<svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="11" cy="11" r="8"/>
							<path d="m21 21-4.35-4.35"/>
						</svg>
						<input
							type="search"
							placeholder="Search repositories"
							bind:value={searchQuery}
						/>
					</div>
					<div class="view-toggle" role="group" aria-label="View mode">
						<button
							type="button"
							class:active={viewMode === 'grid'}
							onclick={() => setViewMode('grid')}
							aria-label="Grid view"
							title="Grid view"
						>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<rect x="3" y="3" width="7" height="7"/>
								<rect x="14" y="3" width="7" height="7"/>
								<rect x="3" y="14" width="7" height="7"/>
								<rect x="14" y="14" width="7" height="7"/>
							</svg>
						</button>
						<button
							type="button"
							class:active={viewMode === 'list'}
							onclick={() => setViewMode('list')}
							aria-label="List view"
							title="List view (all generations)"
						>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<line x1="8" y1="6" x2="21" y2="6"/>
								<line x1="8" y1="12" x2="21" y2="12"/>
								<line x1="8" y1="18" x2="21" y2="18"/>
								<line x1="3" y1="6" x2="3.01" y2="6"/>
								<line x1="3" y1="12" x2="3.01" y2="12"/>
								<line x1="3" y1="18" x2="3.01" y2="18"/>
							</svg>
						</button>
					</div>
				</div>
			{/if}
		</div>

		{#if wikis.length === 0}
			<p class="muted">No wikis generated yet. Enter a repository URL above to get started.</p>
		{:else if viewMode === 'grid'}
			{@const items = filteredGrid}
			<div class="wiki-grid">
				<button type="button" class="wiki-tile add-tile" onclick={focusRepoInput}>
					<div class="add-icon" aria-hidden="true">
						<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<line x1="12" y1="5" x2="12" y2="19"/>
							<line x1="5" y1="12" x2="19" y2="12"/>
						</svg>
					</div>
					<span class="add-label">Add repo</span>
				</button>
				{#each items as wiki (wiki.id)}
					<a class="wiki-tile" href={getWikiLink(wiki)}>
						<div class="tile-top">
							<span class="source-badge {getSourceBadge(wiki.source_type).cls}">
								{getSourceBadge(wiki.source_type).label}
							</span>
							{#if wiki.version_count > 1}
								<span class="version-count" title="{wiki.version_count} generations">
									{wiki.version_count} versions
								</span>
							{/if}
						</div>
						<div class="tile-name">{getWikiDisplayName(wiki)}</div>
						<div class="tile-meta">
							<span>{wiki.page_count} pages</span>
							{#if wiki.model}
								<span>{shortenModel(wiki.model)}</span>
							{/if}
						</div>
						<div class="tile-footer">
							<span class="status" class:completed={wiki.status === 'completed'} class:failed={wiki.status === 'failed'} class:generating={wiki.status === 'generating'}>
								{wiki.status}
							</span>
							<span class="tile-date">{formatRelativeTime(wiki.updated_at ?? wiki.created_at)}</span>
						</div>
						<button
							type="button"
							class="tile-delete"
							aria-label="Delete wiki"
							title="Delete latest generation"
							onclick={(e) => { e.preventDefault(); e.stopPropagation(); deleteWiki(wiki.id, getWikiDisplayName(wiki)); }}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<polyline points="3 6 5 6 21 6"/>
								<path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/>
								<path d="M10 11v6"/>
								<path d="M14 11v6"/>
							</svg>
						</button>
					</a>
				{/each}
			</div>
			{#if items.length === 0 && searchQuery.trim()}
				<p class="muted search-empty">No repositories match "{searchQuery}".</p>
			{/if}
		{:else}
			{@const items = filteredList}
			<div class="wiki-list">
				{#each items as wiki (wiki.id)}
					<div class="wiki-card">
						<div class="wiki-info">
							<div class="wiki-title-row">
								<span class="source-badge {getSourceBadge(wiki.source_type).cls}">
									{getSourceBadge(wiki.source_type).label}
								</span>
								<a href={getWikiLink(wiki)} class="wiki-name">
									{getWikiDisplayName(wiki)}
								</a>
								{#if wiki.version > 1}
									<span class="version-tag">v{wiki.version}</span>
								{/if}
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
			{#if items.length === 0 && searchQuery.trim()}
				<p class="muted search-empty">No generations match "{searchQuery}".</p>
			{/if}
		{/if}
	</div>
</div>

<style>
	.home {
		/* Cap at ~3 grid columns (3 × 300px tiles + gaps) so wider screens
		   gain side padding instead of cramming a 4th column. */
		max-width: 1000px;
		margin: 0 auto;
	}

	.hero {
		text-align: center;
		padding: 2.5rem 0 2rem;
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
		gap: 1rem;
		flex-wrap: wrap;
	}

	.section-header h2 {
		font-size: 1.25rem;
		color: var(--color-fg-emphasis);
	}

	.section-controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		justify-content: flex-end;
		min-width: 0;
	}

	.search-box {
		position: relative;
		display: flex;
		align-items: center;
		flex: 1;
		max-width: 320px;
	}

	.search-icon {
		position: absolute;
		left: 0.625rem;
		color: var(--color-fg-subtle);
		pointer-events: none;
	}

	.search-box input {
		width: 100%;
		padding: 0.4rem 0.625rem 0.4rem 2rem;
		background: var(--color-bg-default);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		color: var(--color-fg-default);
		font-size: 0.85rem;
	}

	.search-box input:focus {
		outline: none;
		border-color: var(--color-accent-fg);
		box-shadow: 0 0 0 3px var(--color-accent-shadow);
	}

	.view-toggle {
		display: inline-flex;
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		overflow: hidden;
	}

	.view-toggle button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: var(--color-bg-default);
		color: var(--color-fg-muted);
		border: none;
		cursor: pointer;
		padding: 0;
	}

	.view-toggle button + button {
		border-left: 1px solid var(--color-border-default);
	}

	@media (hover: hover) {
		.view-toggle button:hover {
			color: var(--color-fg-default);
			background: var(--color-bg-hover);
		}
	}

	.view-toggle button.active {
		background: var(--color-accent-subtle);
		color: var(--color-accent-fg);
	}

	.muted {
		color: var(--color-fg-subtle);
	}

	.search-empty {
		padding: 1rem 0;
	}

	/* Grid view */
	.wiki-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 0.875rem;
	}

	.wiki-tile {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 140px;
		padding: 1rem 1.125rem;
		background: var(--color-bg-subtle);
		border: 1px solid var(--color-border-default);
		border-radius: 8px;
		color: var(--color-fg-default);
		text-decoration: none;
		transition: border-color 0.12s ease, transform 0.12s ease;
	}

	@media (hover: hover) {
		.wiki-tile:hover {
			text-decoration: none;
			border-color: var(--color-accent-fg);
		}

		.wiki-tile:hover .tile-delete {
			opacity: 1;
		}
	}

	.tile-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.tile-name {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-accent-fg);
		word-break: break-word;
	}

	.tile-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.625rem;
		font-size: 0.8rem;
		color: var(--color-fg-subtle);
	}

	.tile-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: auto;
		padding-top: 0.5rem;
		font-size: 0.75rem;
	}

	.tile-date {
		color: var(--color-fg-subtle);
	}

	.tile-delete {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		padding: 0;
		background: var(--color-bg-default);
		color: var(--color-fg-subtle);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.12s ease, color 0.12s ease, border-color 0.12s ease;
	}

	@media (hover: hover) {
		.tile-delete:hover {
			color: var(--color-danger-fg);
			border-color: var(--color-danger-fg);
		}
	}

	.version-count {
		font-size: 0.7rem;
		color: var(--color-fg-muted);
		background: var(--color-bg-muted);
		padding: 0.1rem 0.45rem;
		border-radius: 10px;
	}

	/* Add-repo tile */
	.add-tile {
		align-items: center;
		justify-content: center;
		text-align: center;
		gap: 0.5rem;
		background: var(--color-bg-default);
		border-style: dashed;
		color: var(--color-fg-muted);
		cursor: pointer;
	}

	@media (hover: hover) {
		.add-tile:hover {
			color: var(--color-accent-fg);
			border-color: var(--color-accent-fg);
			background: var(--color-accent-subtle);
		}
	}

	.add-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		border-radius: 999px;
		background: var(--color-bg-muted);
	}

	@media (hover: hover) {
		.add-tile:hover .add-icon {
			background: var(--color-accent-subtle);
			color: var(--color-accent-fg);
		}
	}

	.add-label {
		font-size: 0.95rem;
		font-weight: 600;
	}

	/* List view (preserved) */
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

	.version-tag {
		font-size: 0.7rem;
		color: var(--color-fg-muted);
		background: var(--color-bg-muted);
		padding: 0.1rem 0.4rem;
		border-radius: 10px;
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

	@media (hover: hover) {
		.delete-btn:hover {
			color: var(--color-danger-fg);
			border-color: var(--color-danger-fg);
		}
	}

	@media (max-width: 540px) {
		.section-header {
			align-items: stretch;
		}

		.section-controls {
			justify-content: space-between;
		}

		.search-box {
			max-width: none;
		}
	}

	/* Tighten the grid below the iPad-portrait boundary so two tiles fit
	   comfortably on a 390px iPhone viewport. Desktop grid (260px minmax)
	   is unchanged above 768px. */
	@media (max-width: 767px) {
		.wiki-grid {
			grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		}
	}
</style>
