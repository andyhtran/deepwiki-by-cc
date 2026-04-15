import { describe, expect, test } from "bun:test";
import { charsToTokens, countTokens, tokensToChars } from "$lib/server/embeddings/tokenizer.js";

describe("countTokens", () => {
	test("returns non-zero for non-empty text", () => {
		expect(countTokens("Hello, world!")).toBeGreaterThan(0);
	});

	test("returns 0 for empty text", () => {
		expect(countTokens("")).toBe(0);
	});

	test("longer text has more tokens", () => {
		const short = countTokens("Hello");
		const long = countTokens("Hello, this is a much longer piece of text with many more words");
		expect(long).toBeGreaterThan(short);
	});

	test("code text tokenizes reasonably", () => {
		const code = `function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}`;
		const tokens = countTokens(code);
		// Should be roughly 30-50 tokens for this code
		expect(tokens).toBeGreaterThan(15);
		expect(tokens).toBeLessThan(100);
	});
});

describe("tokensToChars / charsToTokens", () => {
	test("round-trip approximation", () => {
		const tokens = 100;
		const chars = tokensToChars(tokens);
		const backToTokens = charsToTokens(chars);
		expect(backToTokens).toBe(tokens);
	});

	test("tokensToChars returns 4x token count", () => {
		expect(tokensToChars(100)).toBe(400);
		expect(tokensToChars(0)).toBe(0);
	});

	test("charsToTokens rounds up", () => {
		expect(charsToTokens(401)).toBe(101);
		expect(charsToTokens(400)).toBe(100);
	});
});
