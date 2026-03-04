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

Write a comprehensive wiki page about "${params.pageTitle}" based on the source code provided. The page should:

1. Start with a brief introduction explaining what this part of the codebase does
2. Explain the key concepts, types, and patterns used
3. Walk through the important functions/classes and explain how they work
4. Show how components interact with each other
5. Include code snippets from the source (reference specific files)

${
	params.suggestedDiagrams.length > 0
		? `## Diagrams

Include Mermaid diagrams where helpful. Suggested diagram types for this page: ${params.suggestedDiagrams.join(", ")}

Format Mermaid diagrams as fenced code blocks:
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

Do NOT include the page title as an H1 - it will be added automatically.
Write clear, technical documentation that helps developers understand the codebase.`;
}
