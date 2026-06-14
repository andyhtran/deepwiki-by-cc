<script lang="ts">
import { tick } from "svelte";
import { goto } from "$app/navigation";
import { page as routePage } from "$app/state";
import JobProgress from "$lib/components/JobProgress.svelte";
import TableOfContents from "$lib/components/TableOfContents.svelte";
import type { PageHeading } from "$lib/components/WikiPage.svelte";
import WikiPage from "$lib/components/WikiPage.svelte";
import WikiTree from "$lib/components/WikiTree.svelte";
import { formatAppDate, formatRelativeTime } from "$lib/datetime.js";
import { formatRepoDisplayName } from "$lib/repo-display.js";
import { wikiDrawer } from "$lib/wiki-drawer.svelte";
import { buildWikiPagePath, getWikiPageSlug, resolveWikiPageSlug } from "$lib/wiki-page-slugs.js";

let { data } = $props();
let selectedPageId: string | null = $state(null);
let syncJobId: number | null = $state(null);
let regenerateJobId: number | null = $state(null);
let resumeJobId: number | null = $state(null);
let resuming = $state(false);
let headings: PageHeading[] = $state([]);
let contentArea: HTMLDivElement | null = $state(null);
let activeJobId = $derived(data.activeJobId ?? null);
let lastSelectionRouteKey: string | null = null;
let repoDisplayName = $derived(
	formatRepoDisplayName({
		owner: data.owner,
		repoName: data.repo,
		showOwner: data.display?.showRepoOwner ?? true,
	}),
);
// Mobile-only off-canvas drawer. The toggle button lives in the global
// header (so it doesn't overlap article content); state is shared via
// wikiDrawer so both files stay in sync.

// Lock background scroll while the drawer covers the page so the article
// underneath doesn't scroll behind the open drawer on iOS. Cleanup runs on
// re-execution and unmount, so the else branch is implicit.
$effect(() => {
	if (!wikiDrawer.open) return;
	document.body.style.overflow = "hidden";
	return () => {
		document.body.style.overflow = "";
	};
});
let incompletePageCount = $derived(
	data.pages.filter(
		(p: any) => p.status === "failed" || p.status === "pending" || p.status === "generating",
	).length,
);

$effect(() => {
	const routeKey = `${data.wiki.id}:${data.pageSlug ?? ""}`;
	if (lastSelectionRouteKey === routeKey) return;

	lastSelectionRouteKey = routeKey;
	const routePageEntry = data.pageSlug
		? resolveWikiPageSlug(data.wiki.structure, data.pageSlug)
		: null;
	selectedPageId = routePageEntry?.pageId ?? data.pages[0]?.page_id ?? null;
});

function getSelectedPage() {
	if (!selectedPageId) return null;
	return data.pages.find((p: any) => p.page_id === selectedPageId) || null;
}

async function handleSelectPage(id: string) {
	selectedPageId = id;
	wikiDrawer.open = false;
	const href = getPageHref(id);
	if (`${routePage.url.pathname}${routePage.url.search}` !== href) {
		await goto(href, { noScroll: true, keepFocus: true });
	}
	await tick();
	contentArea?.scrollTo({ top: 0, left: 0, behavior: "auto" });
	window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

function getPageSlug(id: string): string | null {
	return getWikiPageSlug(data.wiki.structure, id);
}

function getPageHref(id: string): string {
	const slug = getPageSlug(id);
	return `${buildWikiPagePath({
		owner: data.owner,
		repo: data.repo,
		pageSlug: slug,
	})}${routePage.url.search}`;
}

function getVersionHref(version: string): string {
	const isLatest = version === String(data.versions[0]?.version);
	return buildWikiPagePath({
		owner: data.owner,
		repo: data.repo,
		pageSlug: selectedPageId ? getPageSlug(selectedPageId) : data.pageSlug,
		version: isLatest ? null : version,
	});
}

async function handleRegenerate() {
	const url = `https://github.com/${data.owner}/${data.repo}`;
	try {
		const res = await fetch("/api/generate", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			// force: true skips the duplicate-wiki check — the user explicitly clicked "Regenerate"
			body: JSON.stringify({ repoUrl: url, force: true }),
		});
		const result = await res.json();
		if (result.jobId) {
			regenerateJobId = result.jobId;
		}
	} catch {
		// Ignore
	}
}

async function handleResume() {
	resuming = true;
	try {
		const res = await fetch(`/api/wikis/by-id/${data.wiki.id}/resume`, {
			method: "POST",
		});
		const result = await res.json();
		if (result.jobId) {
			resumeJobId = result.jobId;
		}
	} catch {
		// Ignore
	} finally {
		resuming = false;
	}
}

async function handleSync() {
	try {
		const res = await fetch(`/api/wikis/${data.owner}/${data.repo}/update`, {
			method: "POST",
		});
		const result = await res.json();
		if (result.jobId) {
			syncJobId = result.jobId;
		}
	} catch {
		// Ignore
	}
}

function handleJobComplete() {
	window.location.reload();
}

function formatDuration(startedAt: string | null, completedAt: string | null): string {
	if (!startedAt || !completedAt) return "";
	const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
	if (ms < 60000) return `${Math.round(ms / 1000)}s`;
	return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function formatTokens(n: number | null): string {
	if (!n) return "0";
	if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
	return String(n);
}

</script>

<svelte:head>
	<title>{data.wiki.title} - DeepWiki</title>
	<link id="hljs-dark" rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" />
	<link id="hljs-light" rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css" {...{disabled: true}} />
</svelte:head>

<svelte:window onkeydown={(e) => { if (e.key === "Escape" && wikiDrawer.open) wikiDrawer.open = false; }} />

<div class="wiki-viewer">
	{#if wikiDrawer.open}
		<button
			type="button"
			class="drawer-backdrop"
			aria-label="Close pages drawer"
			onclick={() => { wikiDrawer.open = false; }}
		></button>
	{/if}
	<aside class="sidebar" class:open={wikiDrawer.open}>
		<div class="sidebar-header">
			<h2><a href="https://github.com/{data.owner}/{data.repo}" target="_blank" rel="noopener noreferrer">{repoDisplayName}</a></h2>
			{#if data.versions && data.versions.length > 1}
				<div class="version-selector">
					<select onchange={(e) => {
						const ver = (e.target as HTMLSelectElement).value;
						window.location.href = getVersionHref(ver);
					}}>
						{#each data.versions as version}
							<option value={version.version} selected={version.version === data.currentVersion}>
								v{version.version} — {version.model} — {formatAppDate(version.created_at)} ({version.page_count} pages){version.embedding_enabled ? ' · emb' : ''}
							</option>
						{/each}
					</select>
				</div>
			{/if}
			<p class="wiki-description">{data.wiki.description || ''}</p>
			{#if data.jobStats}
				<div class="wiki-stats">
					{#if data.jobStats.startedAt && data.jobStats.completedAt}
						<span class="stat" title="Generation time">
							{formatDuration(data.jobStats.startedAt, data.jobStats.completedAt)}
						</span>
					{/if}
					{#if data.jobStats.totalPromptTokens || data.jobStats.totalCompletionTokens}
						<span class="stat" title="Total tokens (prompt + completion)">
							{formatTokens((data.jobStats.totalPromptTokens || 0) + (data.jobStats.totalCompletionTokens || 0))} tokens
						</span>
					{/if}
					{#if data.jobStats.totalCost}
						<span class="stat" title="Estimated cost">
							${data.jobStats.totalCost.toFixed(2)}
						</span>
					{/if}
				</div>
			{/if}
			{#if data.embeddingInfo}
				<div class="embedding-badge" title="Embeddings: {data.embeddingInfo.model}{data.embeddingInfo.fingerprint ? ` (${data.embeddingInfo.fingerprint})` : ''}">
					Embeddings: {data.embeddingInfo.model}{#if data.embeddingInfo.fingerprint} <span class="fingerprint">({data.embeddingInfo.fingerprint})</span>{/if}
				</div>
			{/if}
			{#if data.lastIndexedSha}
				<div class="last-indexed">
					Last indexed: {data.lastIndexedSha.slice(0, 7)}{#if data.lastIndexedAt} · {formatRelativeTime(data.lastIndexedAt)}{/if}
				</div>
			{/if}
		</div>
		<WikiTree
			structure={data.wiki.structure}
			{selectedPageId}
			getPageHref={getPageHref}
			onSelectPage={handleSelectPage}
		/>
		<div class="sidebar-actions">
			{#if incompletePageCount > 0}
				<button class="action-btn resume-btn" onclick={handleResume} disabled={resuming}>
					{resuming ? 'Resuming...' : `Resume (${incompletePageCount} incomplete)`}
				</button>
			{/if}
			<button class="action-btn" onclick={handleRegenerate}>Regenerate</button>
			<button class="action-btn sync-btn" onclick={handleSync}>Sync</button>
		</div>
	</aside>

	<div class="content-area" bind:this={contentArea}>
		{#if resumeJobId}
			<div class="job-overlay">
				<h3>Resuming Failed Pages</h3>
				<JobProgress jobId={resumeJobId} onComplete={handleJobComplete} />
			</div>
		{:else if regenerateJobId}
			<div class="job-overlay">
				<h3>Regenerating Wiki</h3>
				<JobProgress jobId={regenerateJobId} onComplete={handleJobComplete} />
			</div>
		{:else if syncJobId}
			<div class="job-overlay">
				<h3>Syncing Wiki</h3>
				<JobProgress jobId={syncJobId} onComplete={handleJobComplete} />
			</div>
		{:else if activeJobId}
			<div class="job-overlay">
				<h3>Generating Wiki</h3>
				<JobProgress jobId={activeJobId} onComplete={handleJobComplete} />
			</div>
		{:else}
			<WikiPage
				page={getSelectedPage()}
				sourceBaseUrl={data.wiki.source_type === 'github' ? `https://github.com/${data.owner}/${data.repo}/blob/${data.defaultBranch}/` : undefined}
				onHeadings={(h) => { headings = h; }}
			/>
		{/if}
	</div>

	{#if !resumeJobId && !regenerateJobId && !syncJobId && headings.length > 0}
		<aside class="toc-sidebar">
			<TableOfContents {headings} />
		</aside>
	{/if}
</div>

<style>
	.wiki-viewer {
		display: flex;
		gap: 0;
		min-height: calc(100vh - 120px);
		margin: -2rem -1.5rem;
	}

	.sidebar {
		width: 280px;
		min-width: 280px;
		background: var(--color-bg-subtle);
		border-right: 1px solid var(--color-border-default);
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		padding: 1rem 0;
		/* Stick to the viewport as the page scrolls. `align-self: flex-start`
		   opts out of the flex parent's default stretch so the sidebar uses
		   its own 100vh height instead of matching the content column — that
		   bounded height is what lets `overflow-y: auto` actually scroll the
		   tree when it's longer than the viewport.
		   Offset by --header-height so the sidebar tucks under the sticky top
		   bar instead of being hidden behind it. */
		position: sticky;
		top: var(--header-height);
		height: calc(100vh - var(--header-height));
		align-self: flex-start;
	}

	.sidebar-header {
		padding: 0 1rem 1rem;
		border-bottom: 1px solid var(--color-border-muted);
		margin-bottom: 0.5rem;
	}

	.sidebar-header h2 {
		font-size: 0.95rem;
		color: var(--color-fg-emphasis);
		word-break: break-all;
	}

	.version-selector {
		margin-top: 0.5rem;
	}

	.version-selector select {
		width: 100%;
		padding: 0.375rem 0.5rem;
		background: var(--color-bg-default);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		color: var(--color-fg-default);
		font-size: 0.75rem;
	}

	.version-selector select:focus {
		outline: none;
		border-color: var(--color-accent-fg);
	}

	.wiki-description {
		font-size: 0.8rem;
		color: var(--color-fg-subtle);
		margin-top: 0.25rem;
	}

	.wiki-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.stat {
		font-size: 0.7rem;
		color: var(--color-fg-muted);
		background: var(--color-bg-default);
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
		border: 1px solid var(--color-border-muted);
	}

	.sidebar-actions {
		margin-top: auto;
		padding: 1rem;
		border-top: 1px solid var(--color-border-muted);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.action-btn {
		padding: 0.375rem 0.75rem;
		background: var(--color-bg-muted);
		color: var(--color-fg-default);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		font-size: 0.8rem;
		cursor: pointer;
		text-align: center;
		text-decoration: none;
		display: inline-block;
	}

	.resume-btn {
		background: var(--color-success-bg);
		border-color: var(--color-success-emphasis);
		color: var(--color-success-fg);
	}

	.sync-btn {
		background: var(--color-accent-subtle);
		border-color: var(--color-accent-emphasis);
		color: var(--color-accent-fg);
	}

	@media (hover: hover) {
		.action-btn:hover:not(:disabled) {
			background: var(--color-border-default);
		}

		.resume-btn:hover:not(:disabled) {
			background: var(--color-success-emphasis);
			color: #fff;
		}

		.sync-btn:hover:not(:disabled) {
			background: var(--color-accent-emphasis);
			color: #fff;
		}
	}

	.embedding-badge {
		font-size: 0.7rem;
		color: var(--color-fg-muted);
		margin-top: 0.5rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.embedding-badge .fingerprint {
		opacity: 0.6;
		font-family: monospace;
	}

	.last-indexed {
		font-size: 0.7rem;
		color: var(--color-fg-muted);
		margin-top: 0.5rem;
		font-family: monospace;
	}

	.content-area {
		flex: 1;
		padding: 2rem 3rem;
		overflow-y: auto;
		min-width: 0;
	}

	.toc-sidebar {
		width: 220px;
		min-width: 220px;
		padding: 2rem 1rem;
		border-left: 1px solid var(--color-border-muted);
	}

	@media (max-width: 1100px) {
		.toc-sidebar {
			display: none;
		}
	}

	.job-overlay {
		max-width: 600px;
		margin: 2rem auto;
	}

	.job-overlay h3 {
		font-size: 1.1rem;
		color: var(--color-fg-emphasis);
		margin-bottom: 1rem;
	}

	/* Backdrop is mobile-only; hidden by default so desktop layout is
	   byte-for-byte unchanged. */
	.drawer-backdrop {
		display: none;
	}

	@media (max-width: 767px) {
		/* Pull the sidebar out of flex flow and slide it in from the left
		   over the content. dvh (not vh) so iOS Safari's collapsing URL
		   bar doesn't truncate the drawer height. */
		.sidebar {
			position: fixed;
			top: var(--header-height);
			left: 0;
			width: 280px;
			min-width: 0;
			height: calc(100dvh - var(--header-height));
			transform: translateX(-100%);
			transition: transform 200ms ease;
			z-index: 15;
			box-shadow: 2px 0 12px rgba(0, 0, 0, 0.25);
			border-right: 1px solid var(--color-border-default);
		}

		.sidebar.open {
			transform: translateX(0);
		}

		.drawer-backdrop {
			display: block;
			position: fixed;
			inset: var(--header-height) 0 0 0;
			background: rgba(0, 0, 0, 0.45);
			border: 0;
			padding: 0;
			cursor: pointer;
			z-index: 14;
			animation: fade-in 150ms ease;
		}

		@keyframes fade-in {
			from { opacity: 0; }
			to { opacity: 1; }
		}

		.content-area {
			padding: 1rem 1rem;
		}
	}
</style>
