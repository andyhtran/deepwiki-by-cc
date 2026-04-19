import type { WikiOutline } from "$lib/types.js";

export interface NormalizerFile {
	filePath: string;
	language: string | null;
}

export interface NormalizeOutlineOptions {
	files: NormalizerFile[];
	maxFilePathsPerPage?: number;
	overviewMinNonDocFiles?: number;
	overviewMaxDocRatio?: number;
	lowComplexityFileThreshold?: number;
}

const DOC_EXTENSION_RE = /\.(md|mdx|markdown|rst|txt)$/i;
const README_BASENAME_RE = /^readme(\.[\w]+)?$/i;

// Diagram suggestions on pages that only cover a couple of files are almost
// never useful and encourage the model to draw a diagram anyway. Cleared below.
const DIAGRAMS_MAX_PER_PAGE = 2;

function isDocFile(filePath: string): boolean {
	return DOC_EXTENSION_RE.test(filePath);
}

function isReadme(filePath: string): boolean {
	const parts = filePath.split("/");
	const basename = parts[parts.length - 1];
	return README_BASENAME_RE.test(basename);
}

// Ordered list of likely entrypoint paths. Checked against the scanned repo
// file list; the first matches are candidates for injection into an Overview
// page that currently has no runtime/code file assignments.
const ENTRYPOINT_EXACT_PATTERNS: string[] = [
	"package.json",
	"src/index.ts",
	"src/index.tsx",
	"src/index.js",
	"src/index.mjs",
	"src/index.svelte",
	"src/main.ts",
	"src/main.js",
	"src/main.py",
	"src/main.go",
	"src/main.rs",
	"src/app.ts",
	"src/app.js",
	"src/app.svelte",
	"src/server.ts",
	"src/server.js",
	"index.ts",
	"index.js",
	"index.py",
	"index.go",
	"index.rs",
	"index.mjs",
	"main.ts",
	"main.js",
	"main.py",
	"main.go",
	"main.rs",
	"server.ts",
	"server.js",
	"server.py",
	"app.py",
	"app.rb",
];

const ENTRYPOINT_REGEX_PATTERNS: RegExp[] = [
	/^cmd\/[^/]+\/main\.go$/,
	/^src\/routes\/(?:.+\/)?\+page\.svelte$/,
	/^src\/routes\/(?:.+\/)?\+layout\.svelte$/,
];

function findEntrypointCandidates(files: NormalizerFile[]): string[] {
	const fileSet = new Set(files.map((f) => f.filePath));
	const candidates: string[] = [];

	for (const pattern of ENTRYPOINT_EXACT_PATTERNS) {
		if (fileSet.has(pattern) && !candidates.includes(pattern)) {
			candidates.push(pattern);
		}
	}
	for (const re of ENTRYPOINT_REGEX_PATTERNS) {
		for (const f of files) {
			if (re.test(f.filePath) && !candidates.includes(f.filePath)) {
				candidates.push(f.filePath);
			}
		}
	}
	return candidates;
}

// Lower = kept longer. README-like files rank highest so they survive doc-ratio
// trimming; everything else is equivalent and dropped first.
function docPriority(filePath: string): number {
	return isReadme(filePath) ? 0 : 1;
}

export function normalizeOutline(outline: WikiOutline, opts: NormalizeOutlineOptions): WikiOutline {
	const {
		files,
		maxFilePathsPerPage = 25,
		overviewMinNonDocFiles = 2,
		overviewMaxDocRatio = 0.5,
		lowComplexityFileThreshold = 2,
	} = opts;

	const fileSet = new Set(files.map((f) => f.filePath));
	// Docs-only repos (e.g. a pure wiki / spec repo) are exempt from overview
	// rewriting — there's no runtime file to promote.
	const repoHasCodeFiles = files.some((f) => !isDocFile(f.filePath));
	const entrypointCandidates = repoHasCodeFiles ? findEntrypointCandidates(files) : [];

	return {
		...outline,
		sections: outline.sections.map((section, sectionIndex) => {
			// The outline prompt says the first section should be Overview, but we
			// check id/title as a safety net in case the model renames it.
			const isOverviewSection =
				section.id === "overview" ||
				section.title.toLowerCase().trim() === "overview" ||
				sectionIndex === 0;

			return {
				...section,
				pages: section.pages.map((page) => {
					// 1 + 2: dedupe exact matches, drop paths not in the repo (model
					// hallucinations), and clamp to the per-page cap.
					const seen = new Set<string>();
					let filePaths: string[] = [];
					for (const p of page.filePaths || []) {
						if (seen.has(p)) continue;
						seen.add(p);
						if (!fileSet.has(p)) continue;
						filePaths.push(p);
						if (filePaths.length >= maxFilePathsPerPage) break;
					}

					// 3: Overview normalization — inject entrypoints when the overview
					// is code-starved, then cap doc ratio.
					if (isOverviewSection && repoHasCodeFiles) {
						const codeCount = filePaths.filter((p) => !isDocFile(p)).length;
						if (codeCount < overviewMinNonDocFiles) {
							let injected = 0;
							const injectBudget = 2;
							for (const ep of entrypointCandidates) {
								if (injected >= injectBudget) break;
								if (filePaths.includes(ep)) continue;
								if (filePaths.length >= maxFilePathsPerPage) break;
								filePaths = [...filePaths, ep];
								injected++;
								const newCodeCount = filePaths.filter((p) => !isDocFile(p)).length;
								if (newCodeCount >= overviewMinNonDocFiles) break;
							}
						}

						const docFiles = filePaths.filter((p) => isDocFile(p));
						const total = filePaths.length;
						if (total > 0 && docFiles.length / total > overviewMaxDocRatio) {
							const nonDoc = filePaths.filter((p) => !isDocFile(p));
							// Sort ascending by priority → README-like come first, so
							// slice(0, keptDocs) keeps them and drops the tail.
							const docsSorted = [...docFiles].sort((a, b) => docPriority(a) - docPriority(b));
							let keptDocs = docsSorted.length;
							while (keptDocs > 0 && keptDocs / (nonDoc.length + keptDocs) > overviewMaxDocRatio) {
								keptDocs--;
							}
							const keepSet = new Set(docsSorted.slice(0, keptDocs));
							filePaths = filePaths.filter((p) => !isDocFile(p) || keepSet.has(p));
						}
					}

					// 4 + 5: diagrams handling. Preserve `undefined` vs `[]` distinction
					// so outlines that never suggested diagrams stay that way.
					let diagrams = page.diagrams;
					if (Array.isArray(diagrams)) {
						if (filePaths.length <= lowComplexityFileThreshold) {
							diagrams = [];
						} else {
							diagrams = diagrams.slice(0, DIAGRAMS_MAX_PER_PAGE);
						}
					}

					return {
						...page,
						filePaths,
						diagrams,
					};
				}),
			};
		}),
	};
}
