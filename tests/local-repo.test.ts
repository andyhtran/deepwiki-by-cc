import { describe, expect, test } from "bun:test";
import { isLocalPath, parseRepoInput, parseRepoUrl } from "$lib/server/pipeline/git.js";

describe("isLocalPath", () => {
	test("detects absolute paths", () => {
		expect(isLocalPath("/Users/me/project")).toBe(true);
		expect(isLocalPath("/tmp/repo")).toBe(true);
	});

	test("detects home-relative paths", () => {
		expect(isLocalPath("~/Code/project")).toBe(true);
		expect(isLocalPath("~")).toBe(true);
	});

	test("detects relative paths", () => {
		expect(isLocalPath("./my-project")).toBe(true);
		expect(isLocalPath("../other-project")).toBe(true);
	});

	test("does not match GitHub URLs", () => {
		expect(isLocalPath("https://github.com/owner/repo")).toBe(false);
		expect(isLocalPath("github.com/owner/repo")).toBe(false);
		expect(isLocalPath("owner/repo")).toBe(false);
	});

	test("trims whitespace before checking", () => {
		expect(isLocalPath("  /tmp/repo  ")).toBe(true);
		expect(isLocalPath("  ~/Code  ")).toBe(true);
	});
});

describe("parseRepoInput", () => {
	test("routes GitHub URLs to parseRepoUrl", () => {
		const result = parseRepoInput("https://github.com/facebook/react");
		expect(result.isLocal).toBe(false);
		expect(result.owner).toBe("facebook");
		expect(result.name).toBe("react");
	});

	test("routes owner/repo to parseRepoUrl", () => {
		const result = parseRepoInput("facebook/react");
		expect(result.isLocal).toBe(false);
		expect(result.owner).toBe("facebook");
	});

	test("routes absolute paths to parseLocalPath", () => {
		expect(() => parseRepoInput("/nonexistent/path/to/repo")).toThrow("Path does not exist");
	});

	test("routes tilde paths to parseLocalPath", () => {
		expect(() => parseRepoInput("~/nonexistent-repo-12345")).toThrow();
	});

	test("routes relative paths to parseLocalPath", () => {
		expect(() => parseRepoInput("./nonexistent-local-repo")).toThrow();
	});

	test("throws on invalid input that isn't local or GitHub", () => {
		expect(() => parseRepoInput("not-a-valid-thing")).toThrow();
	});

	test("parses ./ as local path", () => {
		// "./" should detect as local and resolve to CWD
		const result = parseRepoInput("./");
		expect(result.isLocal).toBe(true);
		expect(result.owner).toBe("local");
		expect(result.localPath).toBeDefined();
	});
});

describe("parseRepoUrl still works", () => {
	test("returns isLocal = false for GitHub URLs", () => {
		const result = parseRepoUrl("https://github.com/facebook/react");
		expect(result.isLocal).toBe(false);
		expect(result.owner).toBe("facebook");
		expect(result.name).toBe("react");
	});

	test("returns isLocal = false for short format", () => {
		const result = parseRepoUrl("facebook/react");
		expect(result.isLocal).toBe(false);
	});
});
