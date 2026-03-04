<script lang="ts">
import { theme } from "$lib/theme.svelte";
</script>

<button
	class="theme-toggle"
	onclick={() => theme.cycle()}
	title="Theme: {theme.preference}"
	aria-label="Toggle theme ({theme.preference})"
>
	{#if theme.preference === 'light'}
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<circle cx="12" cy="12" r="4"/>
			<path d="M12 2v2"/>
			<path d="M12 20v2"/>
			<path d="M4.93 4.93l1.41 1.41"/>
			<path d="M17.66 17.66l1.41 1.41"/>
			<path d="M2 12h2"/>
			<path d="M20 12h2"/>
			<path d="M6.34 17.66l-1.41 1.41"/>
			<path d="M19.07 4.93l-1.41 1.41"/>
		</svg>
	{:else if theme.preference === 'dark'}
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
		</svg>
	{:else}
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
			<line x1="8" y1="21" x2="16" y2="21"/>
			<line x1="12" y1="17" x2="12" y2="21"/>
		</svg>
	{/if}
</button>

<style>
	.theme-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: none;
		border: 1px solid transparent;
		border-radius: 6px;
		color: var(--color-fg-muted);
		cursor: pointer;
		padding: 0;
	}

	.theme-toggle:hover {
		color: var(--color-fg-default);
		background: var(--color-bg-hover);
		border-color: var(--color-border-default);
	}
</style>
