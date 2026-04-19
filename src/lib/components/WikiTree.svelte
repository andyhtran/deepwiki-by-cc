<script lang="ts">
interface Section {
	id: string;
	title: string;
	pages: { id: string; title: string }[];
}

interface Structure {
	sections: Section[];
}

let {
	structure,
	selectedPageId,
	onSelectPage,
}: {
	structure: Structure;
	selectedPageId: string | null;
	onSelectPage: (id: string) => void;
} = $props();
</script>

<nav class="wiki-tree">
	{#if structure?.sections}
		{#each structure.sections as section}
			<div class="section">
				<h3 class="section-header">{section.title}</h3>
				<ul class="page-list">
					{#each section.pages as page}
						<li>
							<button
								class="page-link"
								class:active={selectedPageId === page.id}
								onclick={() => onSelectPage(page.id)}
							>
								{page.title}
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	{/if}
</nav>

<style>
	.wiki-tree {
		width: 100%;
	}

	.section {
		margin-bottom: 0.5rem;
	}

	/* Non-interactive section label; no hover/cursor so users understand
	   only the pages beneath are clickable. */
	.section-header {
		margin: 0;
		padding: 0.5rem 0.75rem;
		color: var(--color-fg-emphasis);
		font-size: 0.85rem;
		font-weight: 600;
		text-align: left;
	}

	.page-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.page-link {
		display: block;
		width: 100%;
		padding: 0.375rem 0.75rem 0.375rem 1.5rem;
		background: none;
		border: none;
		color: var(--color-fg-muted);
		font-size: 0.85rem;
		cursor: pointer;
		text-align: left;
		border-radius: 6px;
	}

	.page-link:hover {
		background: var(--color-bg-hover);
		color: var(--color-fg-default);
	}

	.page-link.active {
		background: var(--color-accent-subtle);
		color: var(--color-accent-fg);
	}
</style>
