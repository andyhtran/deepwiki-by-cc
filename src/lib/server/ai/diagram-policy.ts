import { extractMermaidDiagrams } from "./generator.js";

export const MAX_DIAGRAMS_PER_PAGE = 2;

const MERMAID_FENCE_RE = /```mermaid\n([\s\S]*?)```/g;

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
	const blocks: MermaidBlock[] = [];
	MERMAID_FENCE_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = MERMAID_FENCE_RE.exec(content)) !== null) {
		const code = match[1].trim();
		blocks.push({
			start: match.index,
			end: match.index + match[0].length,
			code,
			signature: normalizeMermaidSignature(code),
		});
	}
	return blocks;
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

	const diagrams = extractMermaidDiagrams(newContent);
	return { content: newContent, diagrams };
}
