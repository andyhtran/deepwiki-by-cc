import { describe, expect, test } from "bun:test";
import {
	buildWikiPagePath,
	buildWikiPageSlugEntries,
	resolveWikiPageSlug,
	slugifyWikiPageTitle,
} from "$lib/wiki-page-slugs.js";

const structure = {
	sections: [
		{
			pages: [
				{ id: "system-overview", title: "System Overview" },
				{ id: "setup-flow", title: "Setup Flow" },
			],
		},
		{
			pages: [
				{ id: "admin-console", title: "Admin Console" },
				{ id: "access-controls", title: "Access Controls" },
			],
		},
	],
};

describe("wiki page slugs", () => {
	test("numbers pages by section and page order", () => {
		expect(buildWikiPageSlugEntries(structure).map((entry) => entry.slug)).toEqual([
			"1.1-system-overview",
			"1.2-setup-flow",
			"2.1-admin-console",
			"2.2-access-controls",
		]);
	});

	test("normalizes titles for URL path segments", () => {
		expect(slugifyWikiPageTitle("Validation Rules: Inputs, Errors, and Reports")).toBe(
			"validation-rules-inputs-errors-and-reports",
		);
	});

	test("resolves canonical and legacy page-id slugs", () => {
		expect(resolveWikiPageSlug(structure, "2.2-access-controls")?.pageId).toBe("access-controls");
		expect(resolveWikiPageSlug(structure, "setup-flow")?.slug).toBe("1.2-setup-flow");
	});

	test("builds page paths with the version query after the slug", () => {
		expect(
			buildWikiPagePath({
				owner: "example-owner",
				repo: "example-repo",
				pageSlug: "10.2-validation-rules",
				version: 1,
			}),
		).toBe("/example-owner/example-repo/10.2-validation-rules?v=1");
	});
});
