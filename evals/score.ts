// Eval scorer: computes deterministic metrics and (unless --skip-qa) grades
// the wiki against the golden question set using an LLM judge.
//
// Usage: bun evals/score.ts --label baseline [--skip-qa] [--judge-model <id>]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { invokeGenerationModel } from "../src/lib/server/ai/provider.js";
import { resolveGenerationModel } from "../src/lib/server/config.js";
import {
	buildWikiCorpus,
	computeCitationStats,
	computeCoreFileCoverage,
	computeMermaidStats,
	computeSizeStats,
	type EvalPage,
} from "./lib.js";

// Cap keeps the corpus safely under CLI argv limits; a truncated corpus is
// reported so a suspiciously low QA score can be traced back to it.
const MAX_CORPUS_CHARS = 300_000;

interface GoldenQuestion {
	id: string;
	question: string;
	answer: string;
	tags?: string[];
}

interface RunRecord {
	label: string;
	repo: string;
	sha: string;
	model: string;
}

type Verdict = "correct" | "partial" | "incorrect" | "unanswerable";

interface QaItemResult {
	id: string;
	question: string;
	expected: string;
	actual: string;
	verdict: Verdict;
	reason: string;
}

const ANSWER_SCHEMA = {
	type: "object" as const,
	properties: {
		answers: {
			type: "array",
			items: {
				type: "object",
				properties: {
					id: { type: "string" },
					answerable: { type: "boolean" },
					answer: { type: "string" },
				},
				required: ["id", "answerable", "answer"],
			},
		},
	},
	required: ["answers"],
};

const GRADE_SCHEMA = {
	type: "object" as const,
	properties: {
		grades: {
			type: "array",
			items: {
				type: "object",
				properties: {
					id: { type: "string" },
					verdict: { type: "string", enum: ["correct", "partial", "incorrect"] },
					reason: { type: "string" },
				},
				required: ["id", "verdict", "reason"],
			},
		},
	},
	required: ["grades"],
};

const repoRoot = resolve(import.meta.dir, "..");

const { values: args } = parseArgs({
	options: {
		label: { type: "string" },
		"skip-qa": { type: "boolean", default: false },
		"judge-model": { type: "string" },
	},
});

if (!args.label) {
	console.error("Usage: bun evals/score.ts --label <label> [--skip-qa] [--judge-model <id>]");
	process.exit(1);
}

const resultsDir = join(repoRoot, "evals", "results", args.label);
if (!existsSync(join(resultsDir, "run.json"))) {
	console.error(`No run found for label "${args.label}" (expected ${resultsDir}/run.json)`);
	process.exit(1);
}

const run = JSON.parse(readFileSync(join(resultsDir, "run.json"), "utf-8")) as RunRecord;
const pages = JSON.parse(readFileSync(join(resultsDir, "pages.json"), "utf-8")) as EvalPage[];
const repoFiles = JSON.parse(readFileSync(join(resultsDir, "repoFiles.json"), "utf-8")) as string[];

const evalConfig = JSON.parse(readFileSync(join(repoRoot, "evals", "config.json"), "utf-8")) as {
	judgeModel: string;
	repos: { name: string; coreFiles: string[] }[];
};
const repoEntry = evalConfig.repos.find((r) => r.name === run.repo);
if (!repoEntry) {
	console.error(`Repo "${run.repo}" from run.json not found in evals/config.json`);
	process.exit(1);
}

const citation = computeCitationStats(pages, repoFiles);
const coverage = computeCoreFileCoverage(pages, repoEntry.coreFiles);
const mermaid = computeMermaidStats(pages);
const size = computeSizeStats(pages);

async function runQa(): Promise<{
	items: QaItemResult[];
	counts: Record<Verdict, number>;
	score: number;
	floorScore: number | null;
	depthScore: number | null;
	corpusTruncated: boolean;
	judgeModel: string;
} | null> {
	const questionsPath = join(repoRoot, "evals", "questions", `${run.repo}.json`);
	if (!existsSync(questionsPath)) {
		console.warn(`No questions file at ${questionsPath} — skipping QA.`);
		return null;
	}
	const questions = JSON.parse(readFileSync(questionsPath, "utf-8")) as GoldenQuestion[];
	const judgeModel = resolveGenerationModel(args["judge-model"] ?? evalConfig.judgeModel);

	const { corpus, truncated } = buildWikiCorpus(pages, MAX_CORPUS_CHARS);
	if (truncated) console.warn("Wiki corpus was truncated to fit the QA context budget.");

	console.log(`Answering ${questions.length} questions from the wiki (judge: ${judgeModel}) ...`);
	const answerPrompt = `You are evaluating the quality of a generated wiki for a software repository.

Below is the COMPLETE generated wiki. Answer each question using ONLY this wiki content. Do not use outside knowledge about the repository, and do not use general programming knowledge to fill in gaps. If the wiki does not contain enough information to answer a question, set "answerable" to false and "answer" to an empty string.

Be exhaustive, not summary-level: for each question, search the ENTIRE wiki (relevant facts may live on several pages) and include every specific detail the wiki provides — concrete default values, limits, thresholds, timeouts, retry behavior, orderings, and edge cases. An answer that omits a detail the wiki actually contains counts against the wiki, so completeness matters more than brevity.

## Wiki content

${corpus}

## Questions

${JSON.stringify(
	questions.map((q) => ({ id: q.id, question: q.question })),
	null,
	2,
)}

Answer every question by id.`;

	const answerResult = await invokeGenerationModel({
		prompt: answerPrompt,
		modelId: judgeModel,
		jsonSchema: ANSWER_SCHEMA,
		timeoutMs: 15 * 60 * 1000,
	});
	const answersOut = answerResult.structuredOutput as
		| { answers?: { id: string; answerable: boolean; answer: string }[] }
		| undefined;
	const answersById = new Map((answersOut?.answers ?? []).map((a) => [a.id, a]));

	const toGrade = questions.filter((q) => answersById.get(q.id)?.answerable);
	let gradesById = new Map<string, { verdict: Verdict; reason: string }>();

	if (toGrade.length > 0) {
		console.log(`Grading ${toGrade.length} answers against the answer key ...`);
		const gradePrompt = `You are grading answers about a codebase against an answer key.

For each item, compare "actualAnswer" to "expectedAnswer" and return a verdict:
- "correct": factually matches the key on all key points
- "partial": gets some key points right but misses or gets others wrong
- "incorrect": contradicts the key or misses its substance

Judge only factual agreement with the key. Wording differences do not matter. Extra detail beyond the key is fine as long as it does not contradict it.

## Items

${JSON.stringify(
	toGrade.map((q) => ({
		id: q.id,
		question: q.question,
		expectedAnswer: q.answer,
		actualAnswer: answersById.get(q.id)?.answer ?? "",
	})),
	null,
	2,
)}

Grade every item by id.`;

		const gradeResult = await invokeGenerationModel({
			prompt: gradePrompt,
			modelId: judgeModel,
			jsonSchema: GRADE_SCHEMA,
			timeoutMs: 10 * 60 * 1000,
		});
		const gradesOut = gradeResult.structuredOutput as
			| { grades?: { id: string; verdict: Verdict; reason: string }[] }
			| undefined;
		gradesById = new Map((gradesOut?.grades ?? []).map((g) => [g.id, g]));
	}

	const items: QaItemResult[] = questions.map((q) => {
		const answer = answersById.get(q.id);
		if (!answer || !answer.answerable) {
			return {
				id: q.id,
				question: q.question,
				expected: q.answer,
				actual: answer?.answer ?? "",
				verdict: "unanswerable" as const,
				reason: answer ? "Judge marked this unanswerable from the wiki." : "No answer returned.",
			};
		}
		const grade = gradesById.get(q.id);
		return {
			id: q.id,
			question: q.question,
			expected: q.answer,
			actual: answer.answer,
			verdict: grade?.verdict ?? "incorrect",
			reason: grade?.reason ?? "No grade returned.",
		};
	});

	const counts: Record<Verdict, number> = {
		correct: 0,
		partial: 0,
		incorrect: 0,
		unanswerable: 0,
	};
	for (const item of items) counts[item.verdict]++;
	const score = (counts.correct + 0.5 * counts.partial) / questions.length;

	// Split scores by tag: "floor" questions any decent wiki answers vs "depth"
	// questions about behavioral specifics that require reading the code closely.
	const depthIds = new Set(
		questions.filter((q) => (q.tags ?? []).includes("depth")).map((q) => q.id),
	);
	const subScore = (subset: QaItemResult[]): number | null => {
		if (subset.length === 0) return null;
		const c = subset.filter((i) => i.verdict === "correct").length;
		const p = subset.filter((i) => i.verdict === "partial").length;
		return (c + 0.5 * p) / subset.length;
	};
	const floorScore = subScore(items.filter((i) => !depthIds.has(i.id)));
	const depthScore = subScore(items.filter((i) => depthIds.has(i.id)));

	return { items, counts, score, floorScore, depthScore, corpusTruncated: truncated, judgeModel };
}

// With --skip-qa, keep any previously computed QA results so deterministic
// metrics can be recomputed without re-paying for judge calls.
function loadExistingQa(): Awaited<ReturnType<typeof runQa>> {
	const scoresPath = join(resultsDir, "scores.json");
	if (!existsSync(scoresPath)) return null;
	const existing = JSON.parse(readFileSync(scoresPath, "utf-8")) as { qa?: unknown };
	return (existing.qa ?? null) as Awaited<ReturnType<typeof runQa>>;
}

const qa = args["skip-qa"] ? loadExistingQa() : await runQa();

const scores = {
	label: run.label,
	scoredAt: new Date().toISOString(),
	deterministic: { citation, coverage, mermaid, size },
	qa,
};
writeFileSync(join(resultsDir, "scores.json"), JSON.stringify(scores, null, "\t"), "utf-8");

const pct = (x: number | null): string => (x === null ? "n/a" : `${(x * 100).toFixed(0)}%`);

console.log(`\n=== Scores for "${run.label}" (${run.repo} @ ${run.sha.slice(0, 12)}) ===\n`);
console.log(
	`Citation validity:  ${pct(citation.validity)} (${citation.validCount}/${citation.candidateCount} cited paths exist)`,
);
if (citation.invalidPaths.length > 0) {
	console.log(
		`  invalid: ${citation.invalidPaths.slice(0, 10).join(", ")}${citation.invalidPaths.length > 10 ? " …" : ""}`,
	);
}
console.log(
	`Core-file coverage: ${pct(coverage.coverage)} (${coverage.covered.length}/${repoEntry.coreFiles.length})`,
);
if (coverage.missing.length > 0) {
	console.log(`  missing: ${coverage.missing.join(", ")}`);
}
console.log(
	`Mermaid diagrams:   ${mermaid.valid}/${mermaid.total} valid${mermaid.total === 0 ? " (none present)" : ""}`,
);
console.log(
	`Size:               ${size.sections} sections, ${size.completedPages}/${size.pages} pages, ~${size.totalWords} words (${size.failedPages} failed)`,
);
if (qa) {
	console.log(
		`\nQA score:           ${pct(qa.score)} — ${qa.counts.correct} correct, ${qa.counts.partial} partial, ${qa.counts.incorrect} incorrect, ${qa.counts.unanswerable} unanswerable`,
	);
	if (qa.depthScore !== null && qa.depthScore !== undefined) {
		console.log(`  floor: ${pct(qa.floorScore)} · depth: ${pct(qa.depthScore)}`);
	}
	for (const item of qa.items) {
		console.log(`  [${item.verdict.padEnd(12)}] ${item.id}`);
	}
}
console.log(`\nSaved: ${join(resultsDir, "scores.json")}`);
