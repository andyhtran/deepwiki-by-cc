import { MERMAID_SYNTAX_RULES } from "./shared.js";

/** Sentinel a schema-less (Codex) update run emits when the page is already current. */
export const NO_CHANGES_SENTINEL = "NO_CHANGES_NEEDED";

export function buildUpdatePrompt(params: {
	repoName: string;
	changeTitle: string;
	changeDescription: string;
	changeDiff: string;
	currentPageContent: string;
	pageTitle: string;
	seedFilePaths: readonly string[];
	outline: string;
	/**
	 * "schema": the caller enforces a {noChangesNeeded, content} JSON schema
	 * (Claude). "final-message": no schema is possible because codex exec's
	 * --output-schema suppresses tool use, so the final message is either the
	 * bare updated markdown or the NO_CHANGES_NEEDED sentinel.
	 */
	outputMode: "schema" | "final-message";
}): string {
	const seedList =
		params.seedFilePaths.length > 0
			? params.seedFilePaths.map((p) => `- ${p}`).join("\n")
			: "- (none recorded — use the diff to find the relevant files)";

	return `You are a technical documentation expert updating a wiki page after code changes were made. You are running inside the updated checkout of the ${params.repoName} repository — use your file-reading and search tools to inspect the code as it is NOW before deciding what to change.

## Wiki Structure
${params.outline}

## Changes
- **Title**: ${params.changeTitle}
- **Description**: ${params.changeDescription}

### Diff
\`\`\`diff
${params.changeDiff.slice(0, 50_000)}
\`\`\`

## Current Wiki Page: ${params.pageTitle}

${params.currentPageContent}

## Source Files This Page Documents
${seedList}

## Research Approach

1. Read the diff to understand what changed, then read the changed files in the checkout to see their current state — the diff shows the delta, the checkout is the truth.
2. Re-verify the page's existing claims against the current code: defaults, limits, behavior, and flow may have shifted even where the page isn't directly contradicted.
3. Follow the change outward if needed — a modified function's callers or configuration may make other statements on this page stale.

## Task

Determine whether this wiki page needs updating. Consider:
1. Did the changes affect any code that this page documents?
2. Are there new functions, classes, or patterns that should be documented?
3. Were existing documented features modified or removed?
4. Do any diagrams need updating?

When writing updated content:
- Do NOT include the page title as an H1 — it will be added automatically. Start the content with an H2 (##) section, matching the existing page's opening style.
- Preserve the existing structure and style
- Only change sections affected by the changes
- Update or add Mermaid diagrams as needed
- Only document content that belongs on THIS page — refer to the wiki structure above to avoid duplicating coverage from other pages
- Headings must describe features, components, or behavior of this repository. Do NOT create headings about documentation methodology or prompt policy (for example: "Code First", "Source of Truth", "Code vs Docs", "Trust Hierarchy").

${MERMAID_SYNTAX_RULES}

${params.outputMode === "schema" ? SCHEMA_OUTPUT_SECTION : FINAL_MESSAGE_OUTPUT_SECTION}`;
}

const SCHEMA_OUTPUT_SECTION = `## Output

If the page needs updates: set "noChangesNeeded" to false and set "content" to the complete updated page in Markdown.
If NO changes are needed: set "noChangesNeeded" to true.
Do not include explanations or meta-commentary in the content field.`;

const FINAL_MESSAGE_OUTPUT_SECTION = `## Output

When you have finished, your FINAL message must be one of exactly two things:
- If NO changes are needed: the single line \`${NO_CHANGES_SENTINEL}\` and nothing else.
- Otherwise: ONLY the complete updated page markdown — no preamble, no summary of what you did, and no code fence wrapping the whole page.`;
