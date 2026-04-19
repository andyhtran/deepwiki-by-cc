<script lang="ts">
import { onMount } from "svelte";

interface TocHeading {
	id: string;
	text: string;
	level: number;
}

let { headings = [] }: { headings: TocHeading[] } = $props();
let activeId = $state("");

onMount(() => {
	if (headings.length === 0) return;

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					activeId = entry.target.id;
				}
			}
		},
		{ rootMargin: "-80px 0px -80% 0px" },
	);

	for (const h of headings) {
		const el = document.getElementById(h.id);
		if (el) observer.observe(el);
	}

	return () => observer.disconnect();
});
</script>

{#if headings.length > 0}
	<nav class="toc">
		<h4>On this page</h4>
		<ul>
			{#each headings as heading}
				<li class:indent={heading.level >= 3}>
					<a
						href="#{heading.id}"
						class:active={activeId === heading.id}
						onclick={(e) => {
							e.preventDefault();
							document.getElementById(heading.id)?.scrollIntoView({ behavior: 'smooth' });
							activeId = heading.id;
						}}
					>
						{heading.text}
					</a>
				</li>
			{/each}
		</ul>
	</nav>
{/if}

<style>
	.toc {
		position: sticky;
		/* Add --header-height so the TOC clears the pinned top bar when the
		   page is scrolled (otherwise its first item would hide behind the
		   sticky header). */
		top: calc(var(--header-height) + 1rem);
	}

	h4 {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-fg-emphasis);
		margin-bottom: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.025em;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		border-left: 1px solid var(--color-border-muted);
	}

	li {
		margin: 0;
	}

	li.indent a {
		padding-left: 1.25rem;
	}

	a {
		display: block;
		padding: 0.25rem 0 0.25rem 0.75rem;
		font-size: 0.8rem;
		color: var(--color-fg-muted);
		text-decoration: none;
		border-left: 2px solid transparent;
		margin-left: -1px;
		line-height: 1.4;
	}

	a:hover {
		color: var(--color-fg-default);
		text-decoration: none;
	}

	a.active {
		color: var(--color-accent-fg);
		border-left-color: var(--color-accent-fg);
	}
</style>
