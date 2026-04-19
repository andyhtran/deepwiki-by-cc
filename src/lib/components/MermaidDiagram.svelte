<script lang="ts">
import { onMount } from "svelte";

let { code }: { code: string } = $props();
let container: HTMLDivElement | null = $state(null);
let rendered = $state(false);

function sanitizeMermaid(src: string): string {
	// Historical wikis (and any model that read our old prompt) emit `->>>` for
	// sequenceDiagram arrows — that's three `>`, which mermaid rejects. The
	// valid arrow is `->>`. Strip the extra `>` before rendering so stale
	// content still displays. `->>>` has no valid meaning in mermaid, so this
	// is safe everywhere in a diagram.
	const normalized = src.replace(/->>>+/g, "->>");
	return normalized.replace(/(\w+)\[([^\]"]+)\]/g, (_match, id: string, label: string) => {
		if (/[():,;{}|<>]/.test(label)) {
			return `${id}["${label.replace(/"/g, "#quot;")}"]`;
		}
		return _match;
	});
}

onMount(async () => {
	if (!container || !code) return;

	const isDark = document.documentElement.getAttribute("data-theme") !== "light";

	try {
		const mermaid = (await import("mermaid")).default;
		mermaid.initialize({
			startOnLoad: false,
			securityLevel: "strict",
			theme: isDark ? "dark" : "default",
			themeVariables: isDark
				? {
						darkMode: true,
						background: "#0d1117",
						primaryColor: "#1f6feb",
						primaryTextColor: "#c9d1d9",
						primaryBorderColor: "#30363d",
						lineColor: "#8b949e",
						secondaryColor: "#161b22",
						tertiaryColor: "#21262d",
					}
				: {
						darkMode: false,
						background: "#ffffff",
						primaryColor: "#ddf4ff",
						primaryTextColor: "#1f2328",
						primaryBorderColor: "#d0d7de",
						lineColor: "#656d76",
						secondaryColor: "#f6f8fa",
						tertiaryColor: "#eaeef2",
					},
		});

		const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
		const sanitized = sanitizeMermaid(code);
		const { svg } = await mermaid.render(id, sanitized);
		container.innerHTML = svg;
		rendered = true;
	} catch (err) {
		console.warn("[mermaid] Render failed:", err instanceof Error ? err.message : err);
		if (container) {
			const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
			container.innerHTML = `<pre class="mermaid-error"><code>${escaped}</code></pre>`;
		}
	}
});
</script>

<div class="mermaid-container" bind:this={container}>
	{#if !rendered}
		<div class="loading">Rendering diagram...</div>
	{/if}
</div>

<style>
	.mermaid-container {
		margin: 1rem 0;
		padding: 1rem;
		background: var(--color-bg-subtle);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		overflow-x: auto;
		text-align: center;
	}

	.mermaid-container :global(svg) {
		max-width: 100%;
		height: auto;
	}

	.loading {
		color: var(--color-fg-subtle);
		font-size: 0.85rem;
		padding: 1rem;
	}

	:global(.mermaid-error) {
		text-align: left;
		color: var(--color-danger-fg);
		font-size: 0.8rem;
		overflow-x: auto;
	}
</style>
