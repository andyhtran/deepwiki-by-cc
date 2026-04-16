import { encodingForModel } from "js-tiktoken";

// Use cl100k_base encoding — compatible with OpenAI embedding models and Claude.
// Lazily initialized so the encoding data is only loaded when actually needed.
let _encoder: ReturnType<typeof encodingForModel> | null = null;

function getEncoder(): ReturnType<typeof encodingForModel> {
	if (!_encoder) {
		_encoder = encodingForModel("gpt-4o");
	}
	return _encoder;
}

/**
 * Counts the number of tokens in a text string.
 * Falls back to a character-based approximation (1 token ≈ 4 chars) if the
 * tokenizer fails, so callers never need to handle errors.
 */
export function countTokens(text: string): number {
	try {
		return getEncoder().encode(text).length;
	} catch {
		return Math.ceil(text.length / 4);
	}
}

/**
 * Converts a token count to an approximate character count.
 * Useful for setting char-based boundaries when working with token budgets.
 */
export function tokensToChars(tokens: number): number {
	return tokens * 4;
}

/**
 * Converts a character count to an approximate token count.
 */
export function charsToTokens(chars: number): number {
	return Math.ceil(chars / 4);
}
