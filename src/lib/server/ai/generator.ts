import type { WikiOutline, WikiOutlinePage } from "$lib/types.js";
import { config } from "../config.js";
import { log } from "../logger.js";
import { retrieveContextForPrompt } from "../pipeline/retriever.js";
import { buildOutlinePrompt } from "../prompts/outline.js";
import { buildPagePrompt } from "../prompts/page.js";
import { buildUpdatePrompt } from "../prompts/update.js";
import { enforceDiagramPolicy } from "./diagram-policy.js";
import { enforceLinkPolicy } from "./link-policy.js";
import { invokeGenerationModel } from "./provider.js";

const PAGE_SCHEMA = {
	type: "object" as const,
	properties: { content: { type: "string" } },
	required: ["content"],
};

const UPDATE_SCHEMA = {
	type: "object" as const,
	properties: {
		noChangesNeeded: { type: "boolean" },
		// Nullable + required: OpenAI strict structured-outputs mode (used by Codex
		// CLI via --output-schema) demands every property key appear in `required`.
		// When noChangesNeeded=true the model returns null here.
		content: { type: ["string", "null"] },
	},
	required: ["noChangesNeeded", "content"],
};

/**
 * Strip a leading `# <page title>` line if the model included one despite
 * the prompt forbidding it. The wiki viewer renders the title as an H1
 * itself, so a duplicated H1 shows as the title twice. Only the very first
 * non-empty line is considered, and only when it matches the page title
 * (case-insensitive, whitespace-collapsed). Non-matching H1s are left alone.
 */
export function stripLeadingTitleHeading(content: string, pageTitle: string): string {
	if (!content) return content;
	const match = content.match(/^\s*#\s+([^\n]+?)\s*\n+/);
	if (!match) return content;
	const normalize = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();
	if (normalize(match[1]) !== normalize(pageTitle)) return content;
	return content.slice(match[0].length);
}

// Headings the model sometimes echoes back from prompt policy wording.
// Matching is on a normalized form (lowercased, punctuation collapsed).
const META_POLICY_HEADINGS: ReadonlySet<string> = new Set([
	"code first",
	"source of truth",
	"code vs docs",
	"docs vs code",
	"trust hierarchy",
	"source trust hierarchy",
]);

function normalizeHeadingText(text: string): string {
	return text
		.replace(/[`*_~]+/g, "")
		.replace(/[^\p{L}\p{N}\s]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

/**
 * Remove or normalize H2/H3 headings whose text is either (a) prompt-policy
 * wording that leaked through, or (b) a bare inline-code span which the
 * prompt forbids but the model occasionally emits anyway.
 *
 * Content inside fenced code blocks is left untouched.
 */
export function sanitizeLeakyHeadings(content: string): string {
	if (!content) return content;

	const lines = content.split("\n");
	const out: string[] = [];
	let inFence = false;
	let fenceChar: "`" | "~" | "" = "";

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Toggle fence state on ``` or ~~~ boundaries. Same char type required
		// to close so nested mixed fences don't confuse us.
		const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
		if (fenceMatch) {
			const marker = fenceMatch[1][0] as "`" | "~";
			if (!inFence) {
				inFence = true;
				fenceChar = marker;
			} else if (marker === fenceChar) {
				inFence = false;
				fenceChar = "";
			}
			out.push(line);
			continue;
		}
		if (inFence) {
			out.push(line);
			continue;
		}

		const headingMatch = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/);
		if (headingMatch) {
			const level = headingMatch[1];
			const text = headingMatch[2];

			if (META_POLICY_HEADINGS.has(normalizeHeadingText(text))) {
				// Also consume a trailing blank line so we don't leave two blanks.
				if (i + 1 < lines.length && lines[i + 1].trim() === "") {
					i++;
				}
				continue;
			}

			// Whole-heading inline code span → unwrap. Mixed headings (code +
			// prose) are left alone to stay conservative.
			const codeSpanMatch = text.match(/^`([^`]+)`$/);
			if (codeSpanMatch) {
				out.push(`${level} ${codeSpanMatch[1]}`);
				continue;
			}
		}

		out.push(line);
	}

	return out.join("\n");
}

export function extractJson(text: string): string {
	let cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "");

	const firstBrace = cleaned.indexOf("{");
	const lastBrace = cleaned.lastIndexOf("}");
	if (firstBrace !== -1 && lastBrace > firstBrace) {
		cleaned = cleaned.slice(firstBrace, lastBrace + 1);
	}

	return cleaned.trim();
}

export function buildOutlineSummary(outline: WikiOutline): string {
	return outline.sections
		.map((s) => {
			const pages = s.pages.map((p) => `  - ${p.title}: ${p.description}`).join("\n");
			return `- **${s.title}**\n${pages}`;
		})
		.join("\n");
}

export interface GenerationUsage {
	promptTokens: number;
	completionTokens: number;
	modelId: string;
}

export async function generateOutline(params: {
	repoName: string;
	fileTree: string;
	readme: string | null;
	fileCount: number;
	languages: string[];
	modelId?: string;
}): Promise<{ outline: WikiOutline; usage: GenerationUsage }> {
	const modelId = params.modelId || config.generationModel;
	log.generator.info({ repo: params.repoName, model: modelId }, "generating outline");
	const prompt = buildOutlinePrompt(params);

	const result = await invokeGenerationModel({
		prompt,
		systemPrompt:
			"You are a JSON generator. Output ONLY valid JSON with no prose, no markdown fences, no explanation. Start your response with { and end with }.",
		modelId,
		timeoutMs: 10 * 60 * 1000,
	});

	const usage: GenerationUsage = {
		promptTokens: result.inputTokens ?? 0,
		completionTokens: result.outputTokens ?? 0,
		modelId,
	};

	const jsonStr = extractJson(result.text);

	try {
		const outline = JSON.parse(jsonStr) as WikiOutline;
		validateOutline(outline);
		return { outline, usage };
	} catch (error) {
		throw new Error(
			`Failed to parse outline JSON: ${error instanceof Error ? error.message : String(error)}\n\nRaw response:\n${result.text.slice(0, 500)}`,
		);
	}
}

export function validateOutline(outline: WikiOutline): void {
	if (!outline.title) throw new Error("Outline missing title");
	if (!outline.sections || !Array.isArray(outline.sections)) {
		throw new Error("Outline missing sections array");
	}
	for (const section of outline.sections) {
		if (!section.id || !section.title) {
			throw new Error(`Invalid section: ${JSON.stringify(section)}`);
		}
		if (!section.pages || !Array.isArray(section.pages)) {
			throw new Error(`Section ${section.id} missing pages array`);
		}
		for (const page of section.pages) {
			if (!page.id || !page.title) {
				throw new Error(`Invalid page in section ${section.id}: ${JSON.stringify(page)}`);
			}
		}
	}
}

export async function generatePage(params: {
	repoId: number;
	repoName: string;
	repoUrl?: string | null;
	defaultBranch?: string | null;
	repoFiles?: readonly string[];
	page: WikiOutlinePage;
	sectionTitle: string;
	outline: WikiOutline;
	generationModel?: string;
}): Promise<{ content: string; diagrams: string[]; usage: GenerationUsage }> {
	const modelId = params.generationModel || config.generationModel;

	log.generator.info({ page: params.page.title, model: modelId }, "generating page");

	const retrievalQuery = [
		params.sectionTitle,
		params.page.title,
		params.page.description,
		...(params.page.filePaths || []),
	]
		.filter((x) => x && x.length > 0)
		.join("\n");

	const { codeContext, source } = await retrieveContextForPrompt({
		repoId: params.repoId,
		filePaths: params.page.filePaths || [],
		queryText: retrievalQuery,
	});
	log.generator.debug(
		{
			page: params.page.title,
			source,
			fileCount: params.page.filePaths?.length ?? 0,
		},
		"resolved page context",
	);

	const outlineSummary = buildOutlineSummary(params.outline);

	const prompt = buildPagePrompt({
		repoName: params.repoName,
		pageTitle: params.page.title,
		pageDescription: params.page.description,
		sectionTitle: params.sectionTitle,
		codeContext,
		suggestedDiagrams: params.page.diagrams || [],
		outline: outlineSummary,
	});

	const result = await invokeGenerationModel({
		prompt,
		modelId,
		jsonSchema: PAGE_SCHEMA,
	});

	const usage: GenerationUsage = {
		promptTokens: result.inputTokens ?? 0,
		completionTokens: result.outputTokens ?? 0,
		modelId,
	};

	const so = result.structuredOutput as { content?: string } | undefined;
	const rawContent = stripLeadingTitleHeading(so?.content ?? result.text, params.page.title);
	const sanitized = sanitizeLeakyHeadings(rawContent);
	const { content: diagramContent, diagrams } = enforceDiagramPolicy(sanitized);
	const content = enforceLinkPolicy(diagramContent, {
		repoUrl: params.repoUrl,
		defaultBranch: params.defaultBranch,
		repoFiles: params.repoFiles,
	});
	return { content, diagrams, usage };
}

export async function generatePageUpdate(params: {
	repoId: number;
	repoName: string;
	repoUrl?: string | null;
	defaultBranch?: string | null;
	repoFiles?: readonly string[];
	changeTitle: string;
	changeDescription: string;
	changeDiff: string;
	currentPageContent: string;
	pageTitle: string;
	filePaths: string[];
	outline: string;
	generationModel?: string;
}): Promise<{ content: string | null; diagrams: string[]; usage: GenerationUsage }> {
	const modelId = params.generationModel || config.generationModel;
	log.generator.info({ page: params.pageTitle, model: modelId }, "updating page");

	const retrievalQuery = [
		params.pageTitle,
		params.changeTitle,
		params.changeDescription,
		params.changeDiff.slice(0, 2000),
		...params.filePaths,
	]
		.filter((x) => x && x.length > 0)
		.join("\n");

	const { codeContext: updatedCodeContext, source } = await retrieveContextForPrompt({
		repoId: params.repoId,
		filePaths: params.filePaths,
		queryText: retrievalQuery,
	});
	log.generator.debug(
		{
			page: params.pageTitle,
			source,
			fileCount: params.filePaths.length,
		},
		"resolved page update context",
	);

	const prompt = buildUpdatePrompt({
		repoName: params.repoName,
		changeTitle: params.changeTitle,
		changeDescription: params.changeDescription,
		changeDiff: params.changeDiff,
		currentPageContent: params.currentPageContent,
		pageTitle: params.pageTitle,
		updatedCodeContext,
		outline: params.outline,
	});

	const result = await invokeGenerationModel({
		prompt,
		modelId,
		jsonSchema: UPDATE_SCHEMA,
	});

	const usage: GenerationUsage = {
		promptTokens: result.inputTokens ?? 0,
		completionTokens: result.outputTokens ?? 0,
		modelId,
	};

	const so = result.structuredOutput as { noChangesNeeded?: boolean; content?: string } | undefined;
	if (so?.noChangesNeeded) {
		return { content: null, diagrams: [], usage };
	}
	const rawContent = stripLeadingTitleHeading(so?.content ?? result.text, params.pageTitle);
	const sanitized = sanitizeLeakyHeadings(rawContent);
	const { content: diagramContent, diagrams } = enforceDiagramPolicy(sanitized);
	const content = enforceLinkPolicy(diagramContent, {
		repoUrl: params.repoUrl,
		defaultBranch: params.defaultBranch,
		repoFiles: params.repoFiles,
	});
	return { content, diagrams, usage };
}

export function extractMermaidDiagrams(content: string): string[] {
	const diagrams: string[] = [];
	const regex = /```mermaid\n([\s\S]*?)```/g;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(content)) !== null) {
		const diagram = match[1].trim();
		if (isValidMermaidSyntax(diagram)) {
			diagrams.push(diagram);
		}
	}

	return diagrams;
}

function isValidMermaidSyntax(diagram: string): boolean {
	const firstLine = diagram.split("\n")[0].trim().toLowerCase();
	const validTypes = [
		"graph",
		"flowchart",
		"sequencediagram",
		"classdiagram",
		"statediagram",
		"erdiagram",
		"gantt",
		"pie",
		"gitgraph",
		"mindmap",
		"timeline",
		"quadrantchart",
		"sankey",
		"block",
		"packet",
		"architecture",
	];

	return validTypes.some((type) => firstLine.startsWith(type) || firstLine.startsWith(`${type}-`));
}
