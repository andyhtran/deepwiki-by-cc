import { findTopLevelMermaidFences } from "$lib/markdown-fences.js";

const MAX_DIAGRAMS_PER_PAGE = 2;

// Re-exported so policy consumers (evals) get the scanner and the validators
// from one module. The implementation lives in $lib/markdown-fences.ts because
// the client-side wiki renderer must split on identical fence semantics —
// this policy REMOVES over-cap blocks, so any parsing disagreement between
// the layers corrupts quoted code or renders phantom diagrams.
export { findTopLevelMermaidFences, type MermaidFencedBlock } from "$lib/markdown-fences.js";

const VALID_MERMAID_TYPES = [
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

export function isValidMermaidSyntax(diagram: string): boolean {
	const firstLine = diagram.split("\n")[0].trim().toLowerCase();
	return VALID_MERMAID_TYPES.some(
		(type) => firstLine.startsWith(type) || firstLine.startsWith(`${type}-`),
	);
}

export function extractMermaidDiagrams(content: string): string[] {
	return findTopLevelMermaidFences(content)
		.map((b) => b.code)
		.filter(isValidMermaidSyntax);
}

interface MermaidBlock {
	start: number;
	end: number;
	code: string;
	signature: string;
}

// Signatures are used to dedupe near-duplicate diagrams the model sometimes
// emits (e.g. "Flow Overview" + a second diagram titled identically). The
// normalization is intentionally loose so that whitespace, casing, and plain
// quoted labels collapse together, but distinct structural edits stay unique.
export function normalizeMermaidSignature(code: string): string {
	const meaningfulLines = code
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("%%"));

	let normalized = meaningfulLines.join(" ").toLowerCase();
	normalized = normalized.replace(/\s+/g, " ");
	// [ "label" ] → [label] only for simple alphanumeric + space labels; complex
	// labels with punctuation keep their quotes so we don't over-collapse.
	normalized = normalized.replace(
		/\[\s*"([a-z0-9 _-]+)"\s*\]/g,
		(_m, label: string) => `[${label.trim().replace(/\s+/g, " ")}]`,
	);
	return normalized.trim();
}

function findMermaidBlocks(content: string): MermaidBlock[] {
	return findTopLevelMermaidFences(content).map((b) => ({
		...b,
		signature: normalizeMermaidSignature(b.code),
	}));
}

export function enforceDiagramPolicy(
	content: string,
	maxDiagrams: number = MAX_DIAGRAMS_PER_PAGE,
): { content: string; diagrams: string[] } {
	const blocks = findMermaidBlocks(content);
	if (blocks.length === 0) {
		return { content, diagrams: [] };
	}

	const seenSignatures = new Set<string>();
	const keepBlocks: MermaidBlock[] = [];
	const removeBlocks: MermaidBlock[] = [];

	for (const block of blocks) {
		if (seenSignatures.has(block.signature)) {
			removeBlocks.push(block);
			continue;
		}
		if (keepBlocks.length >= maxDiagrams) {
			removeBlocks.push(block);
			continue;
		}
		seenSignatures.add(block.signature);
		keepBlocks.push(block);
	}

	let newContent = content;
	// Remove highest-offset blocks first so earlier offsets stay valid.
	const sortedRemovals = [...removeBlocks].sort((a, b) => b.start - a.start);
	for (const block of sortedRemovals) {
		let cutEnd = block.end;
		if (newContent[cutEnd] === "\n") cutEnd++;
		newContent = newContent.slice(0, block.start) + newContent.slice(cutEnd);
	}

	// keepBlocks already holds the surviving blocks in document order — no
	// need to re-scan the rebuilt content.
	const diagrams = keepBlocks.map((b) => b.code).filter(isValidMermaidSyntax);
	return { content: newContent, diagrams };
}
