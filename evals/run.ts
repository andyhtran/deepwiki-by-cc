// Eval runner: generates a wiki for a golden repo pinned to a specific SHA
// and records the run under evals/results/<label>/ for scoring.
//
// Usage: bun evals/run.ts --label baseline [--repo self] [--model <id>] [--force]

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";

interface EvalRepoEntry {
	name: string;
	source: string;
	sha: string;
	coreFiles: string[];
}

interface EvalConfig {
	judgeModel: string;
	repos: EvalRepoEntry[];
}

const repoRoot = resolve(import.meta.dir, "..");
const evalDataDir = join(repoRoot, "evals", ".data");
const resultsRoot = join(repoRoot, "evals", "results");

// Must happen before any server module is imported: config.ts resolves the
// data dir at module init, and this is what keeps eval runs out of the real
// SQLite database. All server imports below are dynamic for the same reason.
process.env.DEEPWIKI_DATA_DIR ??= evalDataDir;

const { values: args } = parseArgs({
	options: {
		label: { type: "string" },
		repo: { type: "string", default: "self" },
		model: { type: "string" },
		force: { type: "boolean", default: false },
	},
});

if (!args.label) {
	console.error("Usage: bun evals/run.ts --label <label> [--repo self] [--model <id>] [--force]");
	process.exit(1);
}
const label = args.label;

const evalConfig = JSON.parse(
	readFileSync(join(repoRoot, "evals", "config.json"), "utf-8"),
) as EvalConfig;
const entry = evalConfig.repos.find((r) => r.name === args.repo);
if (!entry) {
	console.error(
		`Unknown eval repo "${args.repo}". Known: ${evalConfig.repos.map((r) => r.name).join(", ")}`,
	);
	process.exit(1);
}

const resultsDir = join(resultsRoot, label);
if (existsSync(resultsDir)) {
	if (!args.force) {
		console.error(
			`Results for label "${label}" already exist at ${resultsDir}. Use --force to overwrite.`,
		);
		process.exit(1);
	}
	rmSync(resultsDir, { recursive: true, force: true });
}

function git(cwd: string, ...gitArgs: string[]): string {
	return execFileSync("git", gitArgs, {
		cwd,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

/**
 * Materialize the golden repo at its pinned SHA as a detached local clone.
 * A clone (rather than a worktree) gives the snapshot a real .git directory,
 * which the scanner already knows to skip.
 */
function materializeSnapshot(sourceDir: string, sha: string): string {
	const parent = join(evalDataDir, "snapshots", `${entry!.name}-${sha.slice(0, 12)}`);
	const dest = join(parent, basename(sourceDir));

	if (existsSync(dest)) {
		try {
			if (git(dest, "rev-parse", "HEAD") === sha) return dest;
		} catch {
			// fall through to rebuild
		}
		rmSync(parent, { recursive: true, force: true });
	}

	try {
		git(sourceDir, "cat-file", "-e", `${sha}^{commit}`);
	} catch {
		throw new Error(
			`Pinned SHA ${sha} not found in ${sourceDir}. Run \`git fetch\` there or update evals/config.json.`,
		);
	}

	mkdirSync(parent, { recursive: true });
	console.log(`Cloning snapshot at ${sha.slice(0, 12)} ...`);
	execFileSync("git", ["clone", "--quiet", sourceDir, dest], { stdio: "inherit" });
	git(dest, "checkout", "--quiet", "--detach", sha);
	return dest;
}

const sourceDir = resolve(repoRoot, entry.source);
const snapshotDir = materializeSnapshot(sourceDir, entry.sha);
console.log(`Snapshot ready: ${snapshotDir}`);
console.log(`Eval data dir: ${process.env.DEEPWIKI_DATA_DIR}`);

// Provenance: which harness (pipeline) version produced this run.
let harnessSha = "unknown";
let harnessDirty = false;
try {
	harnessSha = git(repoRoot, "rev-parse", "HEAD");
	harnessDirty = git(repoRoot, "status", "--porcelain").length > 0;
} catch {
	// not fatal — provenance only
}

const { createJob, getJob, completeJobWithTokens, failJob } = await import(
	"../src/lib/server/db/jobs.js"
);
const { createRepo } = await import("../src/lib/server/db/repos.js");
const { getRepoFilePaths } = await import("../src/lib/server/db/documents.js");
const { getWikiById, getWikiPages } = await import("../src/lib/server/db/wikis.js");
const { parseRepoInput } = await import("../src/lib/server/pipeline/git.js");
const { handleFullGeneration } = await import("../src/lib/server/queue/handlers.js");

const parsed = parseRepoInput(snapshotDir);
const repo = createRepo({ owner: parsed.owner, name: parsed.name, url: parsed.url });

const params: Record<string, unknown> = {
	repoUrl: snapshotDir,
	isLocal: true,
	localPath: snapshotDir,
};
if (args.model) params.generationModel = args.model;

const job = createJob({ type: "full-generation", repo_id: repo.id, params });

const startedAt = new Date().toISOString();
const startMs = Date.now();
console.log(`Starting full generation (job ${job.id}, label "${label}") ...`);

let totals: { promptTokens: number; completionTokens: number; cost: number };
try {
	totals = await handleFullGeneration(job, (progress, message) => {
		console.log(`[gen ${String(progress).padStart(3)}%] ${message}`);
	});
} catch (error) {
	const msg = error instanceof Error ? error.message : String(error);
	failJob(job.id, msg);
	console.error(`Generation failed: ${msg}`);
	process.exit(1);
}
completeJobWithTokens(job.id, totals);
const durationMs = Date.now() - startMs;

const finishedJob = getJob(job.id);
const wikiId = finishedJob?.wiki_id;
if (!wikiId) {
	console.error("Generation finished but no wiki was recorded on the job.");
	process.exit(1);
}
const wiki = getWikiById(wikiId);
if (!wiki) {
	console.error(`Wiki ${wikiId} not found after generation.`);
	process.exit(1);
}

const structure = JSON.parse(wiki.structure) as {
	sections: { id: string; title: string }[];
};
const sectionTitles = new Map(structure.sections.map((s) => [s.id, s.title]));

const wikiPages = getWikiPages(wikiId);
const pages = wikiPages.map((p) => ({
	pageId: p.page_id,
	title: p.title,
	section: p.parent_id ? (sectionTitles.get(p.parent_id) ?? p.parent_id) : null,
	status: p.status,
	content: p.content,
	model: p.model,
	promptTokens: p.prompt_tokens,
	completionTokens: p.completion_tokens,
	generationTimeMs: p.generation_time_ms,
	errorMessage: p.error_message,
}));

const pagesDir = join(resultsDir, "pages");
mkdirSync(pagesDir, { recursive: true });
pages.forEach((p, i) => {
	const header = `# ${p.title}\n\n> Section: ${p.section ?? "(none)"} · Status: ${p.status}\n\n`;
	writeFileSync(
		join(pagesDir, `${String(i + 1).padStart(2, "0")}-${p.pageId}.md`),
		header + (p.content ?? "_(no content)_"),
		"utf-8",
	);
});

writeFileSync(join(resultsDir, "pages.json"), JSON.stringify(pages, null, "\t"), "utf-8");
writeFileSync(
	join(resultsDir, "repoFiles.json"),
	JSON.stringify(getRepoFilePaths(repo.id), null, "\t"),
	"utf-8",
);
writeFileSync(join(resultsDir, "structure.json"), JSON.stringify(structure, null, "\t"), "utf-8");

const run = {
	label,
	repo: entry.name,
	sha: entry.sha,
	harnessSha,
	harnessDirty,
	model: wiki.model,
	// The pipeline is agentic-only now; recorded for report compatibility with
	// runs captured while both modes existed.
	contextMode: "agentic",
	wikiId,
	repoId: repo.id,
	startedAt,
	durationMs,
	totals: {
		promptTokens: totals.promptTokens,
		completionTokens: totals.completionTokens,
		costUsd: totals.cost,
	},
	pageStats: {
		total: pages.length,
		completed: pages.filter((p) => p.status === "completed").length,
		failed: pages.filter((p) => p.status === "failed").length,
	},
};
writeFileSync(join(resultsDir, "run.json"), JSON.stringify(run, null, "\t"), "utf-8");

console.log("");
console.log(`Run "${label}" complete in ${(durationMs / 60_000).toFixed(1)} min`);
console.log(
	`  pages: ${run.pageStats.completed}/${run.pageStats.total} completed, ${run.pageStats.failed} failed`,
);
console.log(
	`  tokens: ${totals.promptTokens} in / ${totals.completionTokens} out · est. cost $${totals.cost.toFixed(2)}`,
);
console.log(`  results: ${resultsDir}`);
console.log(`\nNext: bun evals/score.ts --label ${label}`);
