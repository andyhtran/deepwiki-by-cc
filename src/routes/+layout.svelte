<script>
import { page } from "$app/state";
import { onMount } from "svelte";
import ThemeToggle from "$lib/components/ThemeToggle.svelte";
import { theme } from "$lib/theme.svelte";
import { wikiDrawer } from "$lib/wiki-drawer.svelte";

let { children } = $props();

// The hamburger toggle should only appear on the wiki viewer route. Match
// /<owner>/<repo> (two segments, no top-level reserved like /api or /settings).
let isWikiRoute = $derived.by(() => {
	const parts = page.url.pathname.split("/").filter(Boolean);
	return parts.length === 2 && parts[0] !== "api" && parts[0] !== "settings";
});

onMount(() => {
	theme.init();
});
</script>

<svelte:head>
	<title>DeepWiki</title>
</svelte:head>

<div class="app">
	<header>
		<nav>
			<div class="nav-left">
				{#if isWikiRoute}
					<button
						type="button"
						class="header-drawer-toggle"
						aria-label="Toggle pages drawer"
						aria-expanded={wikiDrawer.open}
						onclick={() => { wikiDrawer.open = !wikiDrawer.open; }}
					>
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<line x1="3" y1="6" x2="21" y2="6"/>
							<line x1="3" y1="12" x2="21" y2="12"/>
							<line x1="3" y1="18" x2="21" y2="18"/>
						</svg>
					</button>
				{/if}
				<a href="/" class="logo">DeepWiki <span class="cc-badge">by CC</span></a>
			</div>
			<div class="nav-actions">
				<a href="/settings" class="nav-link">Settings</a>
				<ThemeToggle />
			</div>
		</nav>
	</header>
	<main>
		{@render children()}
	</main>
</div>

<style>
	:global([data-theme="dark"]) {
		--color-bg-default: #0d1117;
		--color-bg-subtle: #161b22;
		--color-bg-muted: #21262d;
		--color-bg-hover: #1c2128;
		--color-border-default: #30363d;
		--color-border-muted: #21262d;
		--color-fg-default: #c9d1d9;
		--color-fg-emphasis: #f0f6fc;
		--color-fg-muted: #8b949e;
		--color-fg-subtle: #484f58;
		--color-accent-fg: #58a6ff;
		--color-accent-emphasis: #1f6feb;
		--color-accent-subtle: rgba(31, 111, 235, 0.13);
		--color-accent-shadow: rgba(88, 166, 255, 0.15);
		--color-success-emphasis: #238636;
		--color-success-fg: #3fb950;
		--color-success-subtle: rgba(35, 134, 54, 0.13);
		--color-success-bg: #1a4023;
		--color-success-hover: #2ea043;
		--color-danger-fg: #f85149;
		--color-danger-emphasis: #da3633;
		--color-danger-subtle: rgba(248, 81, 73, 0.13);
	}

	:global([data-theme="light"]) {
		--color-bg-default: #ffffff;
		--color-bg-subtle: #f6f8fa;
		--color-bg-muted: #eaeef2;
		--color-bg-hover: #eaeef2;
		--color-border-default: #d0d7de;
		--color-border-muted: #d8dee4;
		--color-fg-default: #1f2328;
		--color-fg-emphasis: #1f2328;
		--color-fg-muted: #656d76;
		--color-fg-subtle: #8c959f;
		--color-accent-fg: #0969da;
		--color-accent-emphasis: #0969da;
		--color-accent-subtle: rgba(9, 105, 218, 0.1);
		--color-accent-shadow: rgba(9, 105, 218, 0.15);
		--color-success-emphasis: #1a7f37;
		--color-success-fg: #1a7f37;
		--color-success-subtle: rgba(26, 127, 55, 0.1);
		--color-success-bg: #dafbe1;
		--color-success-hover: #2da44e;
		--color-danger-fg: #cf222e;
		--color-danger-emphasis: #cf222e;
		--color-danger-subtle: rgba(207, 34, 46, 0.1);
	}

	:global(*) {
		margin: 0;
		padding: 0;
		box-sizing: border-box;
	}

	/* Reserve the header's height when anchor navigation (hash links, TOC
	   clicks) scrolls a target into view, so headings aren't hidden behind
	   the sticky top bar. */
	:global(html) {
		scroll-padding-top: var(--header-height);
	}

	:global(body) {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
		background: var(--color-bg-default);
		color: var(--color-fg-default);
		line-height: 1.6;
	}

	/* Shared header height — referenced by any sticky element that needs to
	   sit below the pinned top bar (wiki sidebar, table of contents, etc.). */
	:global(:root) {
		--header-height: 3.25rem;
	}

	:global(a) {
		color: var(--color-accent-fg);
		text-decoration: none;
	}

	/* Scope underline-on-hover to mouse-equipped devices so iOS Safari doesn't
	   interpret the first tap as "show hover state" and require a second tap
	   to navigate. */
	@media (hover: hover) {
		:global(a:hover) {
			text-decoration: underline;
		}
	}

	:global(button:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.app {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	header {
		background: var(--color-bg-subtle);
		border-bottom: 1px solid var(--color-border-default);
		/* env(safe-area-inset-*) reports the notch/Dynamic-Island insets when
		   installed as a PWA on iOS; in a regular browser tab they're 0. */
		padding:
			max(0.75rem, env(safe-area-inset-top))
			max(1.5rem, env(safe-area-inset-right))
			0.75rem
			max(1.5rem, env(safe-area-inset-left));
		/* Pin the top bar so the DeepWiki logo (home link) and the right-side
		   actions (Settings, theme toggle) stay reachable while scrolling long
		   wiki pages. z-index keeps it above the sticky wiki sidebar / TOC. */
		position: sticky;
		top: 0;
		z-index: 20;
	}

	nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		max-width: 1400px;
		margin: 0 auto;
		width: 100%;
	}

	.nav-left {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.header-drawer-toggle {
		display: none;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		background: transparent;
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		color: var(--color-fg-default);
		cursor: pointer;
	}

	.logo {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--color-fg-emphasis);
	}

	.nav-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.nav-link {
		font-size: 0.85rem;
		color: var(--color-fg-muted);
	}

	@media (hover: hover) {
		.logo:hover {
			text-decoration: none;
			color: var(--color-accent-fg);
		}

		.nav-link:hover {
			color: var(--color-accent-fg);
			text-decoration: none;
		}

		.header-drawer-toggle:hover {
			background: var(--color-bg-hover);
		}
	}

	.cc-badge {
		font-size: 0.6rem;
		font-weight: 500;
		background: var(--color-accent-emphasis);
		color: #fff;
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
		vertical-align: super;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	main {
		flex: 1;
		max-width: 1400px;
		margin: 0 auto;
		width: 100%;
		padding: 2rem 1.5rem;
	}

	@media (max-width: 767px) {
		header {
			padding:
				max(0.5rem, env(safe-area-inset-top))
				max(1rem, env(safe-area-inset-right))
				0.5rem
				max(1rem, env(safe-area-inset-left));
		}

		.logo {
			font-size: 1.05rem;
		}

		.nav-actions {
			gap: 0.5rem;
		}

		.header-drawer-toggle {
			display: inline-flex;
		}
	}
</style>
