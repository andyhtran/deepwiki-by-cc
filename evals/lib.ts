import {
	findTopLevelMermaidFences,
	isValidMermaidSyntax,
} from "../src/lib/server/ai/diagram-policy.js";

export interface EvalPage {
	pageId: string;
	title: string;
	section: string | null;
	status: string;
	content: string | null;
}

// Only extensions that the scanner can actually store as documents. Anything
// outside this list (e.g. .db, .png, method-call spans like `db.pragma`) is
// not treated as a file citation, so it can't skew the validity metric.
const KNOWN_FILE_EXTENSIONS = new Set([
	"ts",
	"tsx",
	"js",
	"jsx",
	"mjs",
	"cjs",
	"svelte",
	"vue",
	"py",
	"go",
	"rs",
	"java",
	"kt",
	"swift",
	"rb",
	"php",
	"c",
	"h",
	"cpp",
	"hpp",
	"cs",
	"css",
	"scss",
	"less",
	"html",
	"sql",
	"json",
	"yaml",
	"yml",
	"toml",
	"xml",
	"md",
	"mdx",
	"sh",
	"bash",
	"zsh",
	"txt",
	"webmanifest",
]);

const GITHUB_BLOB_RE = /github\.com\/[^/\s]+\/[^/\s]+\/blob\/[^/\s]+\/([^)\s#]+)/;

// Paths the scanner can never store as documents: build artifacts, runtime
// data, and skip-listed files. Wikis legitimately mention these (deployment
// docs, scanner-filter docs), so they are runtime references, not source
// citations, and must not count against citation validity.
const NEVER_SCANNED_DIRS = new Set([
	"build",
	"dist",
	"out",
	"node_modules",
	"data",
	"coverage",
	".svelte-kit",
]);
const NEVER_SCANNED_FILES = new Set([
	"package-lock.json",
	"pnpm-lock.yaml",
	"yarn.lock",
	"bun.lockb",
	"credentials.json",
	"service-account.json",
]);

function normalizeCandidate(raw: string): string {
	return raw
		.replace(/^\.\//, "")
		.replace(/^\/+/, "")
		.replace(/#L\d+(-L?\d+)?$/, "")
		.replace(/:\d+(-\d+)?$/, "");
}

function isPathCandidate(s: string): boolean {
	if (s.length === 0 || s.length > 200) return false;
	if (!/^[\w@./-]+$/.test(s)) return false;
	if (s.includes("//") || s.includes("..")) return false;
	// Leading-dot names are extension globs (`.min.js`) or dotfiles (`.env`),
	// not file citations — coverage uses direct substring search instead.
	if (s.startsWith(".")) return false;
	const segments = s.split("/");
	if (NEVER_SCANNED_DIRS.has(segments[0])) return false;
	const lastSeg = segments[segments.length - 1] ?? "";
	if (NEVER_SCANNED_FILES.has(lastSeg)) return false;
	const dotIdx = lastSeg.lastIndexOf(".");
	// Requires a real extension; extensionless names (`justfile`) are skipped.
	if (dotIdx <= 0) return false;
	const ext = lastSeg.slice(dotIdx + 1).toLowerCase();
	return KNOWN_FILE_EXTENSIONS.has(ext);
}

/**
 * Extract file-path-looking references from page markdown. Conservative by
 * design: only inline code spans and markdown link hrefs are considered, so
 * prose mentions are missed rather than risking false "invalid citation"
 * positives from ordinary text.
 */
export function extractPathCandidates(content: string): string[] {
	const found = new Set<string>();

	const codeSpanRe = /`([^`\n]+)`/g;
	let m: RegExpExecArray | null;
	while ((m = codeSpanRe.exec(content)) !== null) {
		const candidate = normalizeCandidate(m[1].trim());
		if (isPathCandidate(candidate)) found.add(candidate);
	}

	const linkRe = /\[[^\]]*\]\(([^)\s]+)\)/g;
	while ((m = linkRe.exec(content)) !== null) {
		const href = m[1];
		const blobMatch = href.match(GITHUB_BLOB_RE);
		if (blobMatch) {
			const candidate = normalizeCandidate(blobMatch[1]);
			if (isPathCandidate(candidate)) found.add(candidate);
			continue;
		}
		if (/^[a-z]+:\/\//i.test(href) || href.startsWith("#")) continue;
		const candidate = normalizeCandidate(href);
		if (isPathCandidate(candidate)) found.add(candidate);
	}

	return [...found].sort();
}

export interface CitationStats {
	candidateCount: number;
	validCount: number;
	invalidPaths: string[];
	/** null when the wiki contains no recognizable file citations */
	validity: number | null;
}

export function computeCitationStats(
	pages: readonly EvalPage[],
	repoFiles: readonly string[],
): CitationStats {
	const fileSet = new Set(repoFiles);
	// Wikis legitimately refer to files by bare basename ("see `generator.ts`"),
	// so a slash-less candidate matching a real file's basename counts as valid.
	const basenames = new Set(repoFiles.map((f) => f.split("/").pop() ?? f));
	const candidates = new Set<string>();
	for (const page of pages) {
		if (!page.content) continue;
		for (const c of extractPathCandidates(page.content)) candidates.add(c);
	}

	// Path-suffix matching: wikis cite files as bare basenames ("`generator.ts`")
	// or trailing path fragments ("`queue/handlers.ts`"). Both refer to real
	// files, so only fragments matching no repo file's tail count as invalid.
	const isValid = (c: string): boolean => {
		if (fileSet.has(c)) return true;
		if (!c.includes("/")) return basenames.has(c);
		const suffix = `/${c}`;
		return repoFiles.some((f) => f.endsWith(suffix));
	};
	const invalidPaths = [...candidates].filter((c) => !isValid(c)).sort();
	const candidateCount = candidates.size;
	const validCount = candidateCount - invalidPaths.length;
	return {
		candidateCount,
		validCount,
		invalidPaths,
		validity: candidateCount === 0 ? null : validCount / candidateCount,
	};
}

export interface CoverageStats {
	covered: string[];
	missing: string[];
	coverage: number;
}

export function computeCoreFileCoverage(
	pages: readonly EvalPage[],
	coreFiles: readonly string[],
): CoverageStats {
	const corpus = pages.map((p) => p.content ?? "").join("\n");
	const covered: string[] = [];
	const missing: string[] = [];
	for (const file of coreFiles) {
		(corpus.includes(file) ? covered : missing).push(file);
	}
	return {
		covered,
		missing,
		coverage: coreFiles.length === 0 ? 1 : covered.length / coreFiles.length,
	};
}

export interface MermaidStats {
	total: number;
	valid: number;
}

export function computeMermaidStats(pages: readonly EvalPage[]): MermaidStats {
	let total = 0;
	let valid = 0;
	for (const page of pages) {
		if (!page.content) continue;
		const blocks = findTopLevelMermaidFences(page.content).map((b) => b.code);
		total += blocks.length;
		valid += blocks.filter((b) => isValidMermaidSyntax(b)).length;
	}
	return { total, valid };
}

export interface SizeStats {
	sections: number;
	pages: number;
	completedPages: number;
	failedPages: number;
	totalWords: number;
	avgWordsPerPage: number;
}

export function computeSizeStats(pages: readonly EvalPage[]): SizeStats {
	const sections = new Set(pages.map((p) => p.section).filter((s) => s !== null));
	const completed = pages.filter((p) => p.status === "completed");
	const totalWords = completed.reduce(
		(n, p) => n + (p.content ? p.content.split(/\s+/).filter(Boolean).length : 0),
		0,
	);
	return {
		sections: sections.size,
		pages: pages.length,
		completedPages: completed.length,
		failedPages: pages.filter((p) => p.status === "failed").length,
		totalWords,
		avgWordsPerPage: completed.length === 0 ? 0 : Math.round(totalWords / completed.length),
	};
}

export interface WikiCorpus {
	corpus: string;
	truncated: boolean;
}

export function buildWikiCorpus(pages: readonly EvalPage[], maxChars: number): WikiCorpus {
	const parts = pages
		.filter((p) => p.status === "completed" && p.content)
		.map((p) => `# ${p.title}${p.section ? `\n_Section: ${p.section}_` : ""}\n\n${p.content}`);
	const full = parts.join("\n\n---\n\n");
	if (full.length <= maxChars) {
		return { corpus: full, truncated: false };
	}
	return {
		corpus: `${full.slice(0, maxChars)}\n\n[wiki content truncated for evaluation]`,
		truncated: true,
	};
}
