import { describe, expect, test } from "bun:test";
import { formatRepoDisplayName, formatRepoDisplayNameFromFullName } from "$lib/repo-display.js";

describe("repo display names", () => {
	test("shows owner and repo by default", () => {
		expect(formatRepoDisplayName({ owner: "example-org", repoName: "example-repo" })).toBe(
			"example-org/example-repo",
		);
	});

	test("can hide owner prefix", () => {
		expect(
			formatRepoDisplayName({
				owner: "example-org",
				repoName: "example-repo",
				showOwner: false,
			}),
		).toBe("example-repo");
	});

	test("can hide owner prefix from full names", () => {
		expect(formatRepoDisplayNameFromFullName("example-org/example-repo", false)).toBe(
			"example-repo",
		);
	});

	test("leaves ambiguous hidden names ambiguous by design", () => {
		expect(formatRepoDisplayNameFromFullName("example-owner-a/shared", false)).toBe("shared");
		expect(formatRepoDisplayNameFromFullName("example-owner-b/shared", false)).toBe("shared");
	});
});
