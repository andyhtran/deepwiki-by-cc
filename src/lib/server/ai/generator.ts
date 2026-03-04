import type { WikiOutline, WikiOutlinePage } from "$lib/types.js";
import { config } from "../config.js";
import { log } from "../logger.js";
import { formatFilesForContext, retrieveFileContents } from "../pipeline/retriever.js";
import { buildOutlinePrompt } from "../prompts/outline.js";
import { buildPagePrompt } from "../prompts/page.js";
import { buildUpdatePrompt } from "../prompts/update.js";
import { invokeClaudeCli } from "./claude-cli.js";

const PAGE_SCHEMA = {
	type: "object" as const,
	properties: { content: { type: "string" } },
	required: ["content"],
};

const UPDATE_SCHEMA = {
	type: "object" as const,
	properties: {
		noChangesNeeded: { type: "boolean" },
		content: { type: "string" },
	},
	required: ["noChangesNeeded"],
};

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

	const result = await invokeClaudeCli({
		prompt,
		systemPrompt:
			"You are a JSON generator. Output ONLY valid JSON with no prose, no markdown fences, no explanation. Start your response with { and end with }.",
		model: modelId,
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
	page: WikiOutlinePage;
	sectionTitle: string;
	outline: WikiOutline;
	generationModel?: string;
}): Promise<{ content: string; diagrams: string[]; usage: GenerationUsage }> {
	const modelId = params.generationModel || config.generationModel;

	log.generator.info({ page: params.page.title, model: modelId }, "generating page");

	const files = retrieveFileContents(params.repoId, params.page.filePaths || []);
	const codeContext = formatFilesForContext(files);

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

	const result = await invokeClaudeCli({
		prompt,
		model: modelId,
		jsonSchema: PAGE_SCHEMA,
	});

	const usage: GenerationUsage = {
		promptTokens: result.inputTokens ?? 0,
		completionTokens: result.outputTokens ?? 0,
		modelId,
	};

	const so = result.structuredOutput as { content?: string } | undefined;
	const content = so?.content ?? result.text;
	const diagrams = extractMermaidDiagrams(content);
	return { content, diagrams, usage };
}

export async function generatePageUpdate(params: {
	repoId: number;
	repoName: string;
	changeTitle: string;
	changeDescription: string;
	changeDiff: string;
	currentPageContent: string;
	pageTitle: string;
	filePaths: string[];
	outline: string;
}): Promise<{ content: string | null; usage: GenerationUsage }> {
	const modelId = config.generationModel;
	log.generator.info({ page: params.pageTitle, model: modelId }, "updating page");

	const files = retrieveFileContents(params.repoId, params.filePaths);
	const updatedCodeContext = formatFilesForContext(files);

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

	const result = await invokeClaudeCli({
		prompt,
		model: modelId,
		jsonSchema: UPDATE_SCHEMA,
	});

	const usage: GenerationUsage = {
		promptTokens: result.inputTokens ?? 0,
		completionTokens: result.outputTokens ?? 0,
		modelId,
	};

	const so = result.structuredOutput as { noChangesNeeded?: boolean; content?: string } | undefined;
	if (so?.noChangesNeeded) {
		return { content: null, usage };
	}
	return { content: so?.content ?? result.text, usage };
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
