import type { WikiOutline, WikiOutlinePage } from "$lib/types.js";
import { config, getGenerationModel } from "../config.js";
import { log } from "../logger.js";
import { buildOutlinePrompt } from "../prompts/outline.js";
import { buildPagePrompt } from "../prompts/page.js";
import { buildUpdatePrompt, NO_CHANGES_SENTINEL } from "../prompts/update.js";
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
	/**
	 * CLI-reported cost when available. More accurate than recomputing from
	 * token counts because it prices cache creation/reads correctly — matters
	 * most for agentic runs, which are cache-heavy.
	 */
	costUsd?: number;
	/**
	 * Cache-served subset of promptTokens (Codex only — Claude reports costUsd
	 * directly). Lets cost estimation apply the cached-input discount instead
	 * of pricing all input at the full rate.
	 */
	cachedTokens?: number;
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
		costUsd: result.costUsd,
		cachedTokens: result.cachedInputTokens,
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

// Read-only exploration tools for agentic generation. No Bash/Write so the
// agent cannot mutate the checkout or run arbitrary commands.
const AGENTIC_TOOLS = ["Read", "Grep", "Glob"] as const;
// Per-call guardrails: exploration multiplies turns, so cap both spend and time.
const AGENTIC_MAX_BUDGET_USD = 2;
const AGENTIC_TIMEOUT_MS = 20 * 60 * 1000;

// codex exec's --output-schema suppresses tool use entirely — the model
// answers immediately in the constrained format, hallucinating instead of
// exploring. Agentic Codex therefore runs schema-less and is told to emit
// bare markdown as its final message (the driver picks the last agent
// message as result.text).
const CODEX_PAGE_OUTPUT_NOTE = `

## Output

When you have finished exploring, your FINAL message must be ONLY the wiki page markdown itself — no preamble, no summary of what you did, and no code fence wrapping the whole page.`;

function isCodexModel(modelId: string): boolean {
	return getGenerationModel(modelId)?.provider === "codex-cli";
}

export async function generatePage(params: {
	repoName: string;
	repoUrl?: string | null;
	defaultBranch?: string | null;
	repoFiles?: readonly string[];
	page: WikiOutlinePage;
	sectionTitle: string;
	outline: WikiOutline;
	generationModel?: string;
	/** Repo checkout the agent explores. */
	clonePath: string;
}): Promise<{ content: string; diagrams: string[]; usage: GenerationUsage }> {
	const modelId = params.generationModel || config.generationModel;

	log.generator.info({ page: params.page.title, model: modelId }, "generating page");

	const outlineSummary = buildOutlineSummary(params.outline);
	const isCodex = isCodexModel(modelId);
	const prompt = buildPagePrompt({
		repoName: params.repoName,
		pageTitle: params.page.title,
		pageDescription: params.page.description,
		sectionTitle: params.sectionTitle,
		seedFilePaths: params.page.filePaths || [],
		suggestedDiagrams: params.page.diagrams || [],
		outline: outlineSummary,
	});
	const result = await invokeGenerationModel({
		prompt: isCodex ? prompt + CODEX_PAGE_OUTPUT_NOTE : prompt,
		modelId,
		jsonSchema: isCodex ? undefined : PAGE_SCHEMA,
		cwd: params.clonePath,
		tools: AGENTIC_TOOLS,
		maxBudgetUsd: AGENTIC_MAX_BUDGET_USD,
		timeoutMs: AGENTIC_TIMEOUT_MS,
	});

	const usage: GenerationUsage = {
		promptTokens: result.inputTokens ?? 0,
		completionTokens: result.outputTokens ?? 0,
		modelId,
		costUsd: result.costUsd,
		cachedTokens: result.cachedInputTokens,
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
	/** Updated repo checkout the agent explores. */
	clonePath: string;
}): Promise<{ content: string | null; diagrams: string[]; usage: GenerationUsage }> {
	const modelId = params.generationModel || config.generationModel;
	log.generator.info({ page: params.pageTitle, model: modelId }, "updating page");

	const isCodex = isCodexModel(modelId);
	const prompt = buildUpdatePrompt({
		repoName: params.repoName,
		changeTitle: params.changeTitle,
		changeDescription: params.changeDescription,
		changeDiff: params.changeDiff,
		currentPageContent: params.currentPageContent,
		pageTitle: params.pageTitle,
		seedFilePaths: params.filePaths,
		outline: params.outline,
		outputMode: isCodex ? "final-message" : "schema",
	});

	const result = await invokeGenerationModel({
		prompt,
		modelId,
		jsonSchema: isCodex ? undefined : UPDATE_SCHEMA,
		cwd: params.clonePath,
		tools: AGENTIC_TOOLS,
		maxBudgetUsd: AGENTIC_MAX_BUDGET_USD,
		timeoutMs: AGENTIC_TIMEOUT_MS,
	});

	const usage: GenerationUsage = {
		promptTokens: result.inputTokens ?? 0,
		completionTokens: result.outputTokens ?? 0,
		modelId,
		costUsd: result.costUsd,
		cachedTokens: result.cachedInputTokens,
	};

	const so = result.structuredOutput as { noChangesNeeded?: boolean; content?: string } | undefined;
	if (so?.noChangesNeeded) {
		return { content: null, diagrams: [], usage };
	}
	if (isCodex && result.text.trim() === NO_CHANGES_SENTINEL) {
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

// Re-exported for existing import sites; implementations live in
// diagram-policy.ts alongside the fence-aware block scanner they share.
export { extractMermaidDiagrams, isValidMermaidSyntax } from "./diagram-policy.js";
