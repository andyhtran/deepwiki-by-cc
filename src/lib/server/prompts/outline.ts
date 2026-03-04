function getScaleGuidance(fileCount: number): string {
	if (fileCount <= 5) {
		return "- This is a very small repository. Create a single Overview section with 1-2 pages. Do not create multiple sections.";
	}
	if (fileCount <= 20) {
		return "- This is a small repository. Create 1-3 sections with 1-2 pages each.";
	}
	if (fileCount <= 50) {
		return "- Create 2-5 sections with 1-3 pages each.";
	}
	return "- Create 3-7 sections with 1-4 pages each.";
}

export function buildOutlinePrompt(params: {
	repoName: string;
	fileTree: string;
	readme: string | null;
	fileCount: number;
	languages: string[];
}): string {
	return `You are a technical documentation expert. Analyze this repository and generate a structured wiki outline.

## Repository: ${params.repoName}

### File Structure (${params.fileCount} files)
\`\`\`
${params.fileTree}
\`\`\`

${params.readme ? `### README\n${params.readme}\n` : ""}

### Languages Used
${params.languages.join(", ")}

## Task

Generate a structured wiki outline for this repository. The wiki should help developers understand:
1. What this project does (overview)
2. How it's architected (high-level structure)
3. Key components and how they work
4. How data flows through the system
5. How to get started / contribute

## Output Format

Return a JSON object with this exact structure:
\`\`\`json
{
  "title": "Project Name Wiki",
  "description": "Brief description of the project",
  "sections": [
    {
      "id": "section-slug",
      "title": "Section Title",
      "description": "What this section covers",
      "pages": [
        {
          "id": "page-slug",
          "title": "Page Title",
          "description": "What this page explains - be specific about what content to generate",
          "filePaths": ["src/relevant/file.ts", "src/other/file.ts"],
          "diagrams": ["architecture", "flow", "class", "sequence"]
        }
      ]
    }
  ]
}
\`\`\`

## Guidelines

${getScaleGuidance(params.fileCount)}
- The wiki size must be proportional to the repository's actual complexity. Do not invent depth or structure that isn't in the code. A small utility with a few files should produce a brief wiki, not a sprawling multi-section document.
- The first section should always be "Overview" with a project overview page
- For each page, include ALL source files involved in the feature — not just core implementation files, but also API routes, UI components, database queries, and configuration that participate in the behavior. Think about the full request lifecycle from user action to response.
- Suggest diagram types where visual explanation would help:
  - "architecture" for system architecture diagrams
  - "flow" for data/control flow diagrams
  - "class" for class/type relationship diagrams
  - "sequence" for interaction sequence diagrams
- Keep section/page IDs as URL-friendly slugs
- Page descriptions guide content generation, so be specific. Call out concrete behaviors to document: edge cases (what happens on duplicate input? on failure?), default configuration values, concurrency semantics, and user-visible behavior — not just the happy path.
- When sibling pages share source files or related concepts, each description must state what belongs on THAT page vs. what its sibling covers. Example: if one page traces the end-to-end request flow and another covers worker internals, the first should say "reference worker behavior at a high level but defer internals to the Job Queue page" and the second should say "deep-dive into worker concurrency and job state machine — assume the reader has seen the request lifecycle overview."

Return ONLY the JSON object, no markdown code fences or other text.`;
}
