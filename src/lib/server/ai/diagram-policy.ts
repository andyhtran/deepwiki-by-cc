const MAX_DIAGRAMS_PER_PAGE = 2;

export interface MermaidFencedBlock {
	/** Offset of the opening fence line. */
	start: number;
	/** Offset just past the closing fence marker (before its newline). */
	end: number;
	code: string;
}

/**
 * Fence-aware scan for top-level mermaid blocks. Pages that document mermaid
 * handling legitimately contain "```mermaid" inside inline code spans and
 * quoted code blocks; naive regex matching mistakes that documentation for
 * diagrams — and the policy below REMOVES over-cap blocks, so a false match
 * would corrupt quoted code. CommonMark rules applied: fences open at line
 * start (≤3 spaces indent) and close only on a bare marker of the same
 * character and at least the same length.
 */
export function findTopLevelMermaidFences(content: string): MermaidFencedBlock[] {
	const blocks: MermaidFencedBlock[] = [];
	const lines = content.split("\n");
	let offset = 0;
	let open: {
		char: string;
		len: number;
		isMermaid: boolean;
		start: number;
		codeLines: string[];
	} | null = null;

	for (const line of lines) {
		const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
		if (m) {
			const marker = m[1];
			const rest = m[2].trim();
			if (!open) {
				const info = rest.split(/\s+/)[0]?.toLowerCase() ?? "";
				open = {
					char: marker[0],
					len: marker.length,
					isMermaid: info === "mermaid",
					start: offset,
					codeLines: [],
				};
			} else if (marker[0] === open.char && marker.length >= open.len && rest === "") {
				if (open.isMermaid) {
					const code = open.codeLines.join("\n").trim();
					if (code) blocks.push({ start: open.start, end: offset + line.length, code });
				}
				open = null;
			} else {
				open.codeLines.push(line);
			}
		} else if (open) {
			open.codeLines.push(line);
		}
		offset += line.length + 1;
	}

	return blocks;
}

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

	const diagrams = extractMermaidDiagrams(newContent);
	return { content: newContent, diagrams };
}
