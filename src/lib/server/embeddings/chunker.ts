import { config } from "../config.js";
import { countTokens, tokensToChars } from "./tokenizer.js";

export interface TextChunk {
	chunkSeq: number;
	chunkText: string;
	offsetStart: number;
	offsetEnd: number;
	tokenCount: number;
}

export interface ChunkingOptions {
	/** Chunk size in characters (used by char-based chunking) */
	chunkSize?: number;
	/** Chunk overlap in characters (used by char-based chunking) */
	chunkOverlap?: number;
	/**
	 * When true, uses token-aware sizing. chunkSize/chunkOverlap are interpreted
	 * as token counts, and actual boundaries are adjusted based on real token counts.
	 * Defaults to false for backward compatibility.
	 */
	tokenAware?: boolean;
	/** Target tokens per chunk (only used when tokenAware=true, default 700) */
	targetTokens?: number;
	/** Overlap tokens (only used when tokenAware=true, default 120) */
	overlapTokens?: number;
}

function chooseChunkEnd(text: string, start: number, hardEnd: number): number {
	if (hardEnd >= text.length) return text.length;

	// Prefer semantic boundaries, but never backtrack so far that chunks become tiny/noisy.
	const minBoundary = start + Math.floor((hardEnd - start) * 0.55);
	const boundaryTokens = ["\n\n", "\n", " ", "\t"];

	for (const token of boundaryTokens) {
		const idx = text.lastIndexOf(token, hardEnd - 1);
		if (idx >= minBoundary) {
			return idx + token.length;
		}
	}

	return hardEnd;
}

/**
 * Character-based chunking (original behavior). Produces chunks with approximate
 * token counts computed after splitting.
 */
export function chunkTextDeterministic(text: string, options: ChunkingOptions = {}): TextChunk[] {
	if (text.length === 0) return [];

	// Token-aware mode: convert token targets to approximate char sizes, then
	// refine after splitting. This preserves the same boundary-aware splitting
	// logic while targeting token budgets.
	if (options.tokenAware) {
		return chunkTextTokenAware(text, options);
	}

	const chunkSize = Math.max(200, options.chunkSize ?? config.embeddingChunkSize);
	const rawOverlap = options.chunkOverlap ?? config.embeddingChunkOverlap;
	const chunkOverlap = Math.max(0, Math.min(chunkSize - 1, rawOverlap));

	const chunks: TextChunk[] = [];
	let start = 0;
	let seq = 0;

	while (start < text.length) {
		const hardEnd = Math.min(start + chunkSize, text.length);
		let end = chooseChunkEnd(text, start, hardEnd);
		if (end <= start) {
			end = hardEnd;
		}

		const chunkText = text.slice(start, end);
		if (chunkText.trim().length > 0) {
			chunks.push({
				chunkSeq: seq++,
				chunkText,
				offsetStart: start,
				offsetEnd: end,
				tokenCount: countTokens(chunkText),
			});
		}

		if (end >= text.length) break;

		// Always make progress, even with extreme overlap settings.
		start = Math.max(end - chunkOverlap, start + 1);
	}

	return chunks;
}

const DEFAULT_TARGET_TOKENS = 700;
const DEFAULT_OVERLAP_TOKENS = 120;

/**
 * Token-aware chunking: targets a specific token count per chunk.
 * Uses character-based heuristic (4 chars/token) as initial estimate, then
 * adjusts the boundary to hit the target token count more precisely.
 */
function chunkTextTokenAware(text: string, options: ChunkingOptions): TextChunk[] {
	const targetTokens = Math.max(50, options.targetTokens ?? DEFAULT_TARGET_TOKENS);
	const overlapTokens = Math.max(
		0,
		Math.min(targetTokens - 1, options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS),
	);

	// Convert token targets to char estimates for initial boundary selection
	const estCharsPerChunk = tokensToChars(targetTokens);
	const estCharsOverlap = tokensToChars(overlapTokens);

	const chunks: TextChunk[] = [];
	let start = 0;
	let seq = 0;

	while (start < text.length) {
		// Start with char-based estimate, then refine
		const hardEnd = Math.min(start + estCharsPerChunk, text.length);
		let end = chooseChunkEnd(text, start, hardEnd);
		if (end <= start) {
			end = hardEnd;
		}

		let chunkText = text.slice(start, end);
		let tokens = countTokens(chunkText);

		// If we're significantly over the target, shrink. If under and there's
		// more text, we can try to extend slightly. Keep it simple: one
		// adjustment pass is enough to get close.
		if (tokens > targetTokens * 1.2 && end < text.length) {
			// Over budget — reduce the end
			const ratio = targetTokens / tokens;
			const reducedEnd = start + Math.floor((end - start) * ratio);
			end = chooseChunkEnd(text, start, reducedEnd);
			if (end <= start) end = reducedEnd;
			chunkText = text.slice(start, end);
			tokens = countTokens(chunkText);
		} else if (tokens < targetTokens * 0.7 && end < text.length) {
			// Under budget — try extending
			const extendedHardEnd = Math.min(start + Math.ceil(estCharsPerChunk * 1.4), text.length);
			const extendedEnd = chooseChunkEnd(text, start, extendedHardEnd);
			if (extendedEnd > end) {
				const extendedText = text.slice(start, extendedEnd);
				const extendedTokens = countTokens(extendedText);
				if (extendedTokens <= targetTokens * 1.15) {
					end = extendedEnd;
					chunkText = extendedText;
					tokens = extendedTokens;
				}
			}
		}

		if (chunkText.trim().length > 0) {
			chunks.push({
				chunkSeq: seq++,
				chunkText,
				offsetStart: start,
				offsetEnd: end,
				tokenCount: tokens,
			});
		}

		if (end >= text.length) break;

		// Advance with overlap
		const overlapChars = Math.min(estCharsOverlap, end - start - 1);
		start = Math.max(end - overlapChars, start + 1);
	}

	return chunks;
}
