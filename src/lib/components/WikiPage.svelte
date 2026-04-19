<script lang="ts">
import type { Tokens } from "marked";
import MermaidDiagram from "./MermaidDiagram.svelte";

export interface PageHeading {
	id: string;
	text: string;
	level: number;
}

type Segment = { type: "html"; value: string } | { type: "mermaid"; code: string };

function escapeHtml(input: string): string {
	return input
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

// Render-time fallback for wikis generated before the server-side link policy
// (or for links that slipped past it). Models sometimes emit file references
// as absolute filesystem paths; if the tail of such a path matches one of the
// page's declared source files, treat it as a reference to that file.
function findRepoFileSuffix(href: string, fileSet: Set<string>): string | null {
	if (!href.startsWith("/") || href.startsWith("//")) return null;
	const trimmed = href.replace(/^\/+/, "");
	if (!trimmed) return null;
	const parts = trimmed.split("/");
	for (let i = 0; i < parts.length; i++) {
		const suffix = parts.slice(i).join("/");
		if (fileSet.has(suffix)) return suffix;
	}
	return null;
}

let {
	page,
	sourceBaseUrl,
	onHeadings,
}: { page: any; sourceBaseUrl?: string; onHeadings?: (headings: PageHeading[]) => void } = $props();
let segments: Segment[] = $state([]);

$effect(() => {
	if (!page?.content) {
		segments = [];
		onHeadings?.([]);
		return;
	}

	renderMarkdown(page.content);
});

// Split markdown on ```mermaid fences into ordered chunks so that each mermaid
// block renders inline at its authored position, not in a trailing appendix.
function splitOnMermaid(
	markdown: string,
): Array<{ type: "text"; value: string } | { type: "mermaid"; code: string }> {
	const chunks: Array<{ type: "text"; value: string } | { type: "mermaid"; code: string }> = [];
	const regex = /```mermaid\n([\s\S]*?)```/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(markdown)) !== null) {
		if (match.index > lastIndex) {
			chunks.push({ type: "text", value: markdown.slice(lastIndex, match.index) });
		}
		chunks.push({ type: "mermaid", code: match[1].trim() });
		lastIndex = match.index + match[0].length;
	}
	if (lastIndex < markdown.length) {
		chunks.push({ type: "text", value: markdown.slice(lastIndex) });
	}
	return chunks;
}

async function renderMarkdown(markdown: string) {
	const { marked } = await import("marked");
	const hljs = (await import("highlight.js")).default;
	const DOMPurify = (await import("dompurify")).default;

	const extractedHeadings: PageHeading[] = [];
	// Shared across segments so heading IDs remain globally unique on the page.
	const idCounts: Record<string, number> = {};

	const renderer = new marked.Renderer();

	renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
		if (lang && hljs.getLanguage(lang)) {
			const highlighted = hljs.highlight(text, { language: lang }).value;
			return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
		}
		const auto = hljs.highlightAuto(text).value;
		return `<pre><code class="hljs">${auto}</code></pre>`;
	};

	// Bind-before-override captures `this === renderer` so the original
	// implementation's call to `this.parser.parseInline(tokens)` resolves the
	// parser that marked attaches to the renderer at parse time.
	const originalLink = renderer.link.bind(renderer);
	const originalImage = renderer.image.bind(renderer);
	const pageFileSet = new Set<string>(
		Array.isArray(page?.file_paths) ? (page.file_paths as string[]) : [],
	);

	renderer.link = (token: Tokens.Link) => {
		const href = token.href ?? "";
		const suffix = findRepoFileSuffix(href, pageFileSet);
		if (!suffix) return originalLink(token);
		if (sourceBaseUrl) {
			return originalLink({ ...token, href: `${sourceBaseUrl}${suffix}` });
		}
		// No GitHub base URL available — drop the link and render the repo
		// path as inline code so the reader still sees which file was meant.
		return `<code>${escapeHtml(suffix)}</code>`;
	};

	renderer.image = (token: Tokens.Image) => {
		const href = token.href ?? "";
		const suffix = findRepoFileSuffix(href, pageFileSet);
		if (!suffix) return originalImage(token);
		// GitHub blob URLs don't serve raw image content, so fall back to
		// inline code regardless of whether sourceBaseUrl is set.
		return `<code>${escapeHtml(suffix)}</code>`;
	};

	renderer.heading = ({ text, depth }: { text: string; depth: number }) => {
		const plainText = text.replace(/<[^>]+>/g, "");
		let id = plainText
			.toLowerCase()
			.replace(/[^\w]+/g, "-")
			.replace(/^-|-$/g, "");

		if (idCounts[id] !== undefined) {
			idCounts[id]++;
			id = `${id}-${idCounts[id]}`;
		} else {
			idCounts[id] = 0;
		}

		if (depth === 2 || depth === 3) {
			extractedHeadings.push({ id, text: plainText, level: depth });
		}

		return `<h${depth} id="${id}">${text}</h${depth}>`;
	};

	const chunks = splitOnMermaid(markdown);
	const nextSegments: Segment[] = [];

	for (const chunk of chunks) {
		if (chunk.type === "mermaid") {
			nextSegments.push({ type: "mermaid", code: chunk.code });
			continue;
		}
		if (!chunk.value.trim()) continue;
		const raw = await marked.parse(chunk.value, { renderer });
		const sanitized = DOMPurify.sanitize(raw, {
			ADD_TAGS: ["div"],
			ADD_ATTR: ["class", "id"],
		});
		nextSegments.push({ type: "html", value: sanitized });
	}

	segments = nextSegments;
	onHeadings?.(extractedHeadings);
}

function formatMs(ms: number | null): string {
	if (!ms) return "";
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
</script>

{#if page}
	<article class="wiki-page">
		<h1>{page.title}</h1>
		{#if page.status === 'generating'}
			<div class="generating-badge">Generating...</div>
		{:else if page.status === 'failed'}
			<div class="error-badge">Generation failed: {page.error_message || 'Unknown error'}</div>
		{/if}

		<div class="content">
			{#each segments as segment}
				{#if segment.type === 'html'}
					{@html segment.value}
				{:else}
					{#key segment.code}
						<MermaidDiagram code={segment.code} />
					{/key}
				{/if}
			{/each}
		</div>

		{#if page.file_paths?.length > 0}
			<div class="source-files">
				<h3>Source Files</h3>
				<ul>
					{#each page.file_paths as path}
						<li>
							{#if sourceBaseUrl}
								<a href="{sourceBaseUrl}{path}" target="_blank" rel="noopener noreferrer"><code>{path}</code></a>
							{:else}
								<code>{path}</code>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if page.model || page.generation_time_ms || page.prompt_tokens}
			<div class="page-stats">
				{#if page.model}
					<span class="page-stat">{page.model}</span>
				{/if}
				{#if page.generation_time_ms}
					<span class="page-stat">{formatMs(page.generation_time_ms)}</span>
				{/if}
				{#if page.prompt_tokens || page.completion_tokens}
					<span class="page-stat">
						{(page.prompt_tokens || 0) + (page.completion_tokens || 0)} tokens
					</span>
				{/if}
			</div>
		{/if}
	</article>
{:else}
	<div class="empty-state">
		<p>Select a page from the sidebar to view its content.</p>
	</div>
{/if}

<style>
	.wiki-page {
		max-width: 900px;
	}

	h1 {
		font-size: 2rem;
		color: var(--color-fg-emphasis);
		margin-bottom: 1rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--color-border-muted);
	}

	.generating-badge {
		display: inline-block;
		padding: 0.25rem 0.75rem;
		background: var(--color-accent-subtle);
		color: var(--color-accent-fg);
		border-radius: 20px;
		font-size: 0.8rem;
		margin-bottom: 1rem;
	}

	.error-badge {
		display: inline-block;
		padding: 0.25rem 0.75rem;
		background: var(--color-danger-subtle);
		color: var(--color-danger-fg);
		border-radius: 20px;
		font-size: 0.8rem;
		margin-bottom: 1rem;
	}

	.content {
		color: var(--color-fg-default);
	}

	.content :global(h2) {
		font-size: 1.5rem;
		color: var(--color-fg-emphasis);
		margin: 2rem 0 1rem;
		padding-bottom: 0.375rem;
		border-bottom: 1px solid var(--color-border-muted);
	}

	.content :global(h3) {
		font-size: 1.25rem;
		color: var(--color-fg-emphasis);
		margin: 1.5rem 0 0.75rem;
	}

	.content :global(p) {
		margin-bottom: 1rem;
	}

	.content :global(pre) {
		background: var(--color-bg-subtle);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		padding: 1rem;
		overflow-x: auto;
		margin-bottom: 1rem;
		font-size: 0.85rem;
		line-height: 1.5;
	}

	.content :global(code) {
		font-family: 'SF Mono', SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;
		font-size: 0.85em;
	}

	.content :global(:not(pre) > code) {
		background: var(--color-bg-subtle);
		padding: 0.2em 0.4em;
		border-radius: 3px;
		font-size: 0.85em;
	}

	.content :global(ul), .content :global(ol) {
		margin-bottom: 1rem;
		padding-left: 2rem;
	}

	.content :global(li) {
		margin-bottom: 0.25rem;
	}

	.content :global(blockquote) {
		border-left: 3px solid var(--color-border-default);
		padding-left: 1rem;
		color: var(--color-fg-muted);
		margin-bottom: 1rem;
	}

	.content :global(strong) {
		color: var(--color-fg-emphasis);
	}

	.content :global(table) {
		width: 100%;
		border-collapse: collapse;
		margin-bottom: 1rem;
	}

	.content :global(th),
	.content :global(td) {
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border-default);
		text-align: left;
	}

	.content :global(th) {
		background: var(--color-bg-subtle);
		font-weight: 600;
		color: var(--color-fg-emphasis);
	}

	.source-files {
		margin-top: 2rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-border-muted);
	}

	.source-files h3 {
		font-size: 0.9rem;
		color: var(--color-fg-muted);
		margin-bottom: 0.5rem;
	}

	.source-files ul {
		list-style: none;
		padding: 0;
	}

	.source-files li {
		margin-bottom: 0.25rem;
	}

	.source-files code {
		font-size: 0.8rem;
		color: var(--color-accent-fg);
	}

	.source-files a {
		text-decoration: none;
	}

	.source-files a:hover code {
		text-decoration: underline;
	}

	.page-stats {
		margin-top: 1.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-border-muted);
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.page-stat {
		font-size: 0.7rem;
		color: var(--color-fg-subtle);
		background: var(--color-bg-default);
		padding: 0.15rem 0.5rem;
		border-radius: 4px;
		border: 1px solid var(--color-border-muted);
	}

	.empty-state {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 300px;
		color: var(--color-fg-subtle);
	}
</style>
