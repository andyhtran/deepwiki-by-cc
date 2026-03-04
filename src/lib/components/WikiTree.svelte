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

let collapsed: Record<string, boolean> = $state({});

function toggleSection(sectionId: string) {
	collapsed[sectionId] = !collapsed[sectionId];
}
</script>

<nav class="wiki-tree">
	{#if structure?.sections}
		{#each structure.sections as section}
			<div class="section">
				<button
					class="section-header"
					onclick={() => toggleSection(section.id)}
				>
					<span class="arrow" class:collapsed={collapsed[section.id]}>&#9662;</span>
					<span class="section-title">{section.title}</span>
				</button>
				{#if !collapsed[section.id]}
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
				{/if}
			</div>
		{/each}
	{/if}
</nav>

<style>
	.wiki-tree {
		width: 100%;
	}

	.section {
		margin-bottom: 0.25rem;
	}

	.section-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: none;
		border: none;
		color: var(--color-fg-emphasis);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		text-align: left;
		border-radius: 6px;
	}

	.section-header:hover {
		background: var(--color-bg-hover);
	}

	.arrow {
		font-size: 0.7rem;
		transition: transform 0.15s;
		color: var(--color-fg-subtle);
	}

	.arrow.collapsed {
		transform: rotate(-90deg);
	}

	.page-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.page-link {
		display: block;
		width: 100%;
		padding: 0.375rem 0.75rem 0.375rem 2rem;
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
