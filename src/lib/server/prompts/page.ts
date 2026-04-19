import { MERMAID_SYNTAX_RULES } from "./shared.js";

export function buildPagePrompt(params: {
	repoName: string;
	pageTitle: string;
	pageDescription: string;
	sectionTitle: string;
	codeContext: string;
	suggestedDiagrams: string[];
	outline: string;
}): string {
	return `You are a technical documentation expert writing a wiki page for the ${params.repoName} repository.

## Wiki Structure
${params.outline}

## Current Page
- **Section**: ${params.sectionTitle}
- **Page**: ${params.pageTitle}
- **Description**: ${params.pageDescription}

## Relevant Source Code
${params.codeContext}

## Task

Write a comprehensive wiki page about "${params.pageTitle}" based on the source code provided. When README or other docs disagree with the implementation, describe what the code actually does; treat docs as supporting context that may be incomplete or out of date. The page should:

1. Start with a brief introduction explaining what this part of the codebase does
2. Explain the key concepts, types, and patterns used
3. Walk through the important functions/classes and explain how they work
4. Show how components interact with each other
5. Include code snippets from the source (reference specific files)

${
	params.suggestedDiagrams.length > 0
		? `## Diagrams budget

Diagrams are optional. Default: 0 diagrams. Include at most 1 diagram when it materially aids understanding; use 2 only for pages covering genuinely complex multi-component flows. Do not add diagrams just because a type is suggested (suggested types for this page: ${params.suggestedDiagrams.join(", ")}).

Place each diagram inline at the point in the prose where it is discussed — not as a trailing appendix. Format Mermaid diagrams as fenced code blocks:
\`\`\`mermaid
graph TD
    A["Component A"] --> B["Component B"]
\`\`\`

Guidelines for diagrams:
- Keep them focused and readable (max 15-20 nodes)
- Use descriptive labels on nodes and edges
- Choose the right diagram type (graph, sequenceDiagram, classDiagram, flowchart, etc.)

${MERMAID_SYNTAX_RULES}`
		: ""
}

## Format

Write in Markdown. Use:
- H2 (##) for major sections within the page
- H3 (###) for subsections
- Code blocks with language tags for code snippets
- Bold for key terms on first use
- Bullet lists for enumerating features/steps
- Plain text for headings — write "## Repos Table" not "## \`repos\`"

Headings must describe features, components, or behavior of this repository. Do NOT create headings about documentation methodology or prompt policy (for example: "Code First", "Source of Truth", "Code vs Docs", "Trust Hierarchy").

Do NOT include the page title as an H1 - it will be added automatically.
Write clear, technical documentation that helps developers understand the codebase.`;
}
