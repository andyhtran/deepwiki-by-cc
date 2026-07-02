// Eval report: prints one run's metrics, or a side-by-side comparison of two.
//
// Usage: bun evals/report.ts <label> [<label2>]

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

interface LoadedRun {
	label: string;
	run: {
		repo: string;
		sha: string;
		model: string;
		contextMode?: string;
		durationMs: number;
		totals: { promptTokens: number; completionTokens: number; costUsd: number };
		pageStats: { total: number; completed: number; failed: number };
	};
	scores: {
		deterministic: {
			citation: { validity: number | null; validCount: number; candidateCount: number };
			coverage: { coverage: number; covered: string[]; missing: string[] };
			mermaid: { total: number; valid: number };
			size: { sections: number; pages: number; totalWords: number; failedPages: number };
		};
		qa: {
			score: number;
			floorScore?: number | null;
			depthScore?: number | null;
			counts: Record<string, number>;
			items: { id: string; verdict: string }[];
			judgeModel: string;
		} | null;
	} | null;
}

const repoRoot = resolve(import.meta.dir, "..");

const { positionals } = parseArgs({ allowPositionals: true, options: {} });
if (positionals.length < 1 || positionals.length > 2) {
	console.error("Usage: bun evals/report.ts <label> [<label2>]");
	process.exit(1);
}

function loadRun(label: string): LoadedRun {
	const dir = join(repoRoot, "evals", "results", label);
	if (!existsSync(join(dir, "run.json"))) {
		console.error(`No run found for label "${label}" (expected ${dir}/run.json)`);
		process.exit(1);
	}
	const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf-8"));
	const scoresPath = join(dir, "scores.json");
	const scores = existsSync(scoresPath) ? JSON.parse(readFileSync(scoresPath, "utf-8")) : null;
	if (!scores)
		console.warn(`Run "${label}" has not been scored yet (bun evals/score.ts --label ${label})`);
	return { label, run, scores };
}

const runs = positionals.map(loadRun);

const pct = (x: number | null | undefined): string =>
	x === null || x === undefined ? "n/a" : `${(x * 100).toFixed(0)}%`;

function metricRows(r: LoadedRun): [string, string][] {
	const d = r.scores?.deterministic;
	const qa = r.scores?.qa;
	return [
		["repo @ sha", `${r.run.repo} @ ${r.run.sha.slice(0, 12)}`],
		["model", r.run.model],
		["context mode", r.run.contextMode ?? "injected"],
		["QA score", qa ? pct(qa.score) : "n/a"],
		["QA floor", qa ? pct(qa.floorScore) : "n/a"],
		["QA depth", qa ? pct(qa.depthScore) : "n/a"],
		[
			"QA verdicts (c/p/i/u)",
			qa
				? `${qa.counts.correct}/${qa.counts.partial}/${qa.counts.incorrect}/${qa.counts.unanswerable}`
				: "n/a",
		],
		[
			"citation validity",
			d
				? `${pct(d.citation.validity)} (${d.citation.validCount}/${d.citation.candidateCount})`
				: "n/a",
		],
		[
			"core-file coverage",
			d ? `${pct(d.coverage.coverage)} (${d.coverage.covered.length} covered)` : "n/a",
		],
		["mermaid valid", d ? `${d.mermaid.valid}/${d.mermaid.total}` : "n/a"],
		["sections / pages", d ? `${d.size.sections} / ${d.size.pages}` : "n/a"],
		["words", d ? String(d.size.totalWords) : "n/a"],
		["failed pages", String(r.run.pageStats.failed)],
		["duration", `${(r.run.durationMs / 60_000).toFixed(1)} min`],
		["tokens in/out", `${r.run.totals.promptTokens}/${r.run.totals.completionTokens}`],
		["est. cost", `$${r.run.totals.costUsd.toFixed(2)}`],
	];
}

const allRows = runs.map(metricRows);
const nameWidth = Math.max(...allRows[0].map(([name]) => name.length));
const colWidths = runs.map((r, i) =>
	Math.max(r.label.length, ...allRows[i].map(([, value]) => value.length)),
);

console.log(
	`${"metric".padEnd(nameWidth)}  ${runs.map((r, i) => r.label.padEnd(colWidths[i])).join("  ")}`,
);
console.log(`${"-".repeat(nameWidth)}  ${colWidths.map((w) => "-".repeat(w)).join("  ")}`);
for (let row = 0; row < allRows[0].length; row++) {
	const name = allRows[0][row][0];
	const values = allRows.map((rows, i) => rows[row][1].padEnd(colWidths[i]));
	console.log(`${name.padEnd(nameWidth)}  ${values.join("  ")}`);
}

// Per-question verdict grid when QA scores exist.
const withQa = runs.filter((r) => r.scores?.qa);
if (withQa.length > 0) {
	const ids = withQa[0].scores!.qa!.items.map((i) => i.id);
	const idWidth = Math.max(...ids.map((id) => id.length), "question".length);
	console.log(`\n${"question".padEnd(idWidth)}  ${withQa.map((r) => r.label).join("  ")}`);
	for (const id of ids) {
		const verdicts = withQa.map((r, i) => {
			const item = r.scores!.qa!.items.find((it) => it.id === id);
			return (item?.verdict ?? "?").padEnd(withQa[i].label.length);
		});
		console.log(`${id.padEnd(idWidth)}  ${verdicts.join("  ")}`);
	}
}
