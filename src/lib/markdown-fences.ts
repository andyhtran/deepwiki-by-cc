// Shared CommonMark-aware mermaid fence parsing. Lives outside $lib/server so
// both the server-side diagram policy and the client-side wiki renderer split
// on the SAME fence semantics — a naive regex on either side treats quoted
// examples (a ```mermaid fence shown inside a wrapping code block) as real
// diagrams and corrupts pages that document mermaid handling.

export interface MermaidFencedBlock {
	/** Offset of the opening fence line. */
	start: number;
	/** Offset just past the closing fence marker (before its newline). */
	end: number;
	code: string;
}

/**
 * Fence-aware scan for top-level mermaid blocks. CommonMark rules applied:
 * fences open at line start (≤3 spaces indent) and close only on a bare
 * marker of the same character and at least the same length, so fences quoted
 * inside other code blocks are treated as content, not diagrams.
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

export type MermaidSplitChunk = { type: "text"; value: string } | { type: "mermaid"; code: string };

/**
 * Split markdown into ordered text/mermaid chunks so each diagram renders
 * inline at its authored position.
 */
export function splitOnMermaidFences(markdown: string): MermaidSplitChunk[] {
	const chunks: MermaidSplitChunk[] = [];
	let lastIndex = 0;
	for (const block of findTopLevelMermaidFences(markdown)) {
		if (block.start > lastIndex) {
			chunks.push({ type: "text", value: markdown.slice(lastIndex, block.start) });
		}
		chunks.push({ type: "mermaid", code: block.code });
		lastIndex = block.end;
	}
	if (lastIndex < markdown.length) {
		chunks.push({ type: "text", value: markdown.slice(lastIndex) });
	}
	return chunks;
}
