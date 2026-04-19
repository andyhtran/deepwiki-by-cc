import { describe, expect, test } from "bun:test";
import { enforceLinkPolicy } from "$lib/server/ai/link-policy.js";

const REPO_FILES = ["src/foo.ts", "src/nested/bar.ts", "docs/diagram.svg", "a.ts"];

const GH = {
	repoUrl: "https://github.com/acme/widget",
	defaultBranch: "main",
	repoFiles: REPO_FILES,
};

describe("enforceLinkPolicy", () => {
	test("rewrites an absolute path to a GitHub blob URL when the tail matches a repo file", () => {
		const input = "See [foo.ts](/home/deepwiki/app/src/foo.ts) for details.";
		const out = enforceLinkPolicy(input, GH);
		expect(out).toBe(
			"See [foo.ts](https://github.com/acme/widget/blob/main/src/foo.ts) for details.",
		);
	});

	test("works with a completely different absolute prefix (not Docker-specific)", () => {
		const input = "See [bar.ts](/workspace/checkout/src/nested/bar.ts).";
		const out = enforceLinkPolicy(input, GH);
		expect(out).toBe("See [bar.ts](https://github.com/acme/widget/blob/main/src/nested/bar.ts).");
	});

	test("also handles bare `/<path>` when the path is already repo-relative", () => {
		const input = "[a](/a.ts)";
		const out = enforceLinkPolicy(input, GH);
		expect(out).toBe("[a](https://github.com/acme/widget/blob/main/a.ts)");
	});

	test("honours a non-default branch", () => {
		const out = enforceLinkPolicy("[a](/home/deepwiki/app/a.ts)", {
			repoUrl: "https://github.com/acme/widget",
			defaultBranch: "develop",
			repoFiles: REPO_FILES,
		});
		expect(out).toBe("[a](https://github.com/acme/widget/blob/develop/a.ts)");
	});

	test("normalises GitHub URLs with a trailing .git or slash", () => {
		const out = enforceLinkPolicy("[a](/home/deepwiki/app/a.ts)", {
			repoUrl: "https://github.com/acme/widget.git/",
			defaultBranch: "main",
			repoFiles: REPO_FILES,
		});
		expect(out).toBe("[a](https://github.com/acme/widget/blob/main/a.ts)");
	});

	test("drops the link to inline code when repoUrl is missing", () => {
		const input = "See [foo.ts](/home/deepwiki/app/src/foo.ts).";
		const out = enforceLinkPolicy(input, { repoFiles: REPO_FILES });
		expect(out).toBe("See `src/foo.ts`.");
	});

	test("drops the link to inline code when repoUrl is not GitHub", () => {
		const input = "See [foo.ts](/home/deepwiki/app/src/foo.ts).";
		const out = enforceLinkPolicy(input, { repoUrl: "local:///tmp/repo", repoFiles: REPO_FILES });
		expect(out).toBe("See `src/foo.ts`.");
	});

	test("leaves plain external links alone", () => {
		const input = "[docs](https://example.com/docs) and [home](https://github.com/acme/widget).";
		expect(enforceLinkPolicy(input, GH)).toBe(input);
	});

	test("leaves relative links alone", () => {
		const input = "[next](./other-page) and [anchor](#section).";
		expect(enforceLinkPolicy(input, GH)).toBe(input);
	});

	test("leaves absolute paths whose tail does not match any repo file alone", () => {
		const input = "[misc](/etc/hosts) and [abs](/usr/local/bin/tool).";
		expect(enforceLinkPolicy(input, GH)).toBe(input);
	});

	test("rewrites image links with the same policy", () => {
		const input = "![alt](/home/deepwiki/app/docs/diagram.svg)";
		const out = enforceLinkPolicy(input, GH);
		expect(out).toBe("![alt](https://github.com/acme/widget/blob/main/docs/diagram.svg)");
	});

	test("image link falls back to inline code when no GitHub URL", () => {
		const input = "![alt](/home/deepwiki/app/docs/diagram.svg)";
		const out = enforceLinkPolicy(input, { repoFiles: REPO_FILES });
		expect(out).toBe("`docs/diagram.svg`");
	});

	test("handles multiple links in the same document", () => {
		const input = "Top: [a](/home/deepwiki/app/a.ts) mid: [b](/ci/build/src/nested/bar.ts) end.";
		const out = enforceLinkPolicy(input, GH);
		expect(out).toBe(
			"Top: [a](https://github.com/acme/widget/blob/main/a.ts) mid: [b](https://github.com/acme/widget/blob/main/src/nested/bar.ts) end.",
		);
	});

	test("is idempotent — running twice is a no-op on the second pass", () => {
		const input =
			"See [foo.ts](/home/deepwiki/app/src/foo.ts) and ![x](/home/deepwiki/app/docs/diagram.svg).";
		const first = enforceLinkPolicy(input, GH);
		const second = enforceLinkPolicy(first, GH);
		expect(second).toBe(first);
	});

	test("is idempotent in inline-code fallback too", () => {
		const input = "See [foo.ts](/home/deepwiki/app/src/foo.ts).";
		const first = enforceLinkPolicy(input, { repoFiles: REPO_FILES });
		const second = enforceLinkPolicy(first, { repoFiles: REPO_FILES });
		expect(second).toBe(first);
	});

	test("empty defaultBranch falls back to main", () => {
		const out = enforceLinkPolicy("[a](/home/deepwiki/app/a.ts)", {
			repoUrl: "https://github.com/acme/widget",
			defaultBranch: "",
			repoFiles: REPO_FILES,
		});
		expect(out).toBe("[a](https://github.com/acme/widget/blob/main/a.ts)");
	});

	test("prefers the longest matching suffix when multiple would match", () => {
		const files = ["bar.ts", "src/nested/bar.ts"];
		const out = enforceLinkPolicy("[x](/home/app/src/nested/bar.ts)", {
			repoUrl: "https://github.com/acme/widget",
			defaultBranch: "main",
			repoFiles: files,
		});
		expect(out).toBe("[x](https://github.com/acme/widget/blob/main/src/nested/bar.ts)");
	});

	test("does nothing when no repoFiles are provided", () => {
		const input = "See [foo.ts](/home/deepwiki/app/src/foo.ts).";
		// Without a file list we can't distinguish hallucinations from legit
		// root-relative URLs, so the content is passed through unchanged.
		expect(enforceLinkPolicy(input, { repoUrl: GH.repoUrl })).toBe(input);
	});
});
