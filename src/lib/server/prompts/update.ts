import { MERMAID_SYNTAX_RULES } from "./shared.js";

export function buildUpdatePrompt(params: {
	repoName: string;
	changeTitle: string;
	changeDescription: string;
	changeDiff: string;
	currentPageContent: string;
	pageTitle: string;
	updatedCodeContext: string;
	outline: string;
}): string {
	return `You are a technical documentation expert updating a wiki page after code changes were made.

## Repository: ${params.repoName}

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

## Updated Source Code
${params.updatedCodeContext}

## Task

Review the code changes and determine if this wiki page needs to be updated. Consider:
1. Did the changes affect any code that this page documents?
2. Are there new functions, classes, or patterns that should be documented?
3. Were existing documented features modified or removed?
4. Do any diagrams need updating?

If the page needs updates:
- Set "noChangesNeeded" to false
- Set "content" to the complete updated page in Markdown
- Do NOT include the page title as an H1 — it will be added automatically. Start the content with an H2 (##) section, matching the existing page's opening style.
- Preserve the existing structure and style
- Only change sections affected by the changes
- Update or add Mermaid diagrams as needed
- Only document content that belongs on THIS page — refer to the wiki structure above to avoid duplicating coverage from other pages

${MERMAID_SYNTAX_RULES}

If NO changes are needed:
- Set "noChangesNeeded" to true

Do not include explanations or meta-commentary in the content field.`;
}
