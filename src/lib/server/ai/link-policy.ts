// Post-processing for generated wiki markdown. Models occasionally emit file
// references as absolute filesystem paths (e.g. an inherited container working
// directory prepended to a real repo-relative path) instead of plain
// repo-relative paths. We rewrite any such link whose tail matches a known
// repo file into a GitHub blob URL (or inline code when no URL is available).

// Matches markdown links and images whose href starts with a single `/` (not
// `//`, which would be a protocol-relative URL). Capture groups:
//   1: "!" for images, empty string otherwise
//   2: link text / alt text
//   3: the full href starting with "/"
const ABSOLUTE_PATH_LINK_RE = /(!?)\[([^\]]*)\]\((\/(?!\/)[^)\s]+)\)/g;

export interface LinkPolicyContext {
	repoUrl?: string | null;
	defaultBranch?: string | null;
	// Full list of repo-relative file paths. Used to identify which suffix of
	// an absolute-path link is the real file reference.
	repoFiles?: readonly string[];
}

interface GitHubRepoRef {
	owner: string;
	name: string;
}

function parseGitHubRepoUrl(url: string): GitHubRepoRef | null {
	const cleaned = url
		.trim()
		.replace(/\/+$/, "")
		.replace(/\.git$/, "");
	const match = cleaned.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/);
	if (!match) return null;
	return { owner: match[1], name: match[2] };
}

// Given an absolute-looking path like `/foo/bar/src/util.ts` and the set of
// known repo files, return the longest suffix of the path that exactly
// matches a repo file (here: `src/util.ts`). Returns null when no suffix
// matches, which means the link is probably a legitimate root-relative URL
// (e.g. `/etc/hosts`, `/docs/section`) and should be left untouched.
function findRepoFileSuffix(absolutePath: string, fileSet: Set<string>): string | null {
	const trimmed = absolutePath.replace(/^\/+/, "");
	if (!trimmed) return null;
	const parts = trimmed.split("/");
	for (let i = 0; i < parts.length; i++) {
		const suffix = parts.slice(i).join("/");
		if (fileSet.has(suffix)) return suffix;
	}
	return null;
}

export function enforceLinkPolicy(content: string, context: LinkPolicyContext = {}): string {
	const fileSet = new Set(context.repoFiles ?? []);
	// Without a file list we can't tell a hallucinated path from a legitimate
	// root-relative link, so skip rewriting entirely.
	if (fileSet.size === 0) return content;

	const github = context.repoUrl ? parseGitHubRepoUrl(context.repoUrl) : null;
	// Fall back to "main" when the repo has no default branch recorded, since
	// the alternative is emitting a broken URL with an empty branch segment.
	const branch =
		context.defaultBranch && context.defaultBranch.length > 0 ? context.defaultBranch : "main";

	return content.replace(
		ABSOLUTE_PATH_LINK_RE,
		(match, bang: string, label: string, href: string) => {
			const suffix = findRepoFileSuffix(href, fileSet);
			if (!suffix) return match;

			if (github) {
				const url = `https://github.com/${github.owner}/${github.name}/blob/${branch}/${suffix}`;
				return `${bang}[${label}](${url})`;
			}

			// No GitHub URL available — drop the link and render the repo path
			// as inline code so readers still see which file is meant.
			return `\`${suffix}\``;
		},
	);
}
