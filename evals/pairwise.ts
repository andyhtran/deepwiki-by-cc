// Pairwise eval: topic-anchored A/B comparison of two runs' wikis.
//
// For each topic in evals/config.json, the best-matching page from each run is
// selected deterministically (keyword frequency) and an LLM judge picks the
// page that better explains how the system works. Every matchup is judged
// twice with the presentation order swapped; disagreement between the two
// orderings counts as a tie, which cancels position bias.
//
// Usage: bun evals/pairwise.ts <labelA> <labelB> [--judge-model <id>]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import pLimit from "p-limit";
import { invokeGenerationModel } from "../src/lib/server/ai/provider.js";
import { resolveGenerationModel } from "../src/lib/server/config.js";
import type { EvalPage } from "./lib.js";

interface PairwiseTopic {
	id: string;
	title: string;
	keywords: string[];
}

interface TopicResult {
	topicId: string;
	title: string;
	pageA: string;
	pageB: string;
	// Verdicts from both presentation orders, already mapped to run labels.
	verdicts: [string, string];
	winner: string; // labelA | labelB | "tie"
	reasons: string[];
}

const VERDICT_SCHEMA = {
	type: "object" as const,
	properties: {
		winner: { type: "string", enum: ["A", "B", "tie"] },
		reason: { type: "string" },
	},
	required: ["winner", "reason"],
};

// Keep each page under a sane size so two pages + instructions stay well below
// CLI argv limits even for verbose wikis.
const MAX_PAGE_CHARS = 40_000;

const repoRoot = resolve(import.meta.dir, "..");

const { values: args, positionals } = parseArgs({
	allowPositionals: true,
	options: { "judge-model": { type: "string" } },
});

if (positionals.length !== 2) {
	console.error("Usage: bun evals/pairwise.ts <labelA> <labelB> [--judge-model <id>]");
	process.exit(1);
}
const [labelA, labelB] = positionals;

function loadRun(label: string): { repo: string; pages: EvalPage[] } {
	const dir = join(repoRoot, "evals", "results", label);
	if (!existsSync(join(dir, "run.json"))) {
		console.error(`No run found for label "${label}" (expected ${dir}/run.json)`);
		process.exit(1);
	}
	const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf-8")) as { repo: string };
	const pages = JSON.parse(readFileSync(join(dir, "pages.json"), "utf-8")) as EvalPage[];
	return { repo: run.repo, pages: pages.filter((p) => p.status === "completed" && p.content) };
}

const runA = loadRun(labelA);
const runB = loadRun(labelB);
if (runA.repo !== runB.repo) {
	console.error(`Runs target different repos (${runA.repo} vs ${runB.repo}) — not comparable.`);
	process.exit(1);
}

const evalConfig = JSON.parse(readFileSync(join(repoRoot, "evals", "config.json"), "utf-8")) as {
	judgeModel: string;
	repos: { name: string; pairwiseTopics?: PairwiseTopic[] }[];
};
const repoEntry = evalConfig.repos.find((r) => r.name === runA.repo);
const topics = repoEntry?.pairwiseTopics ?? [];
if (topics.length === 0) {
	console.error(`No pairwiseTopics configured for repo "${runA.repo}" in evals/config.json`);
	process.exit(1);
}
const judgeModel = resolveGenerationModel(args["judge-model"] ?? evalConfig.judgeModel);

/** Deterministic page pick: keyword hits (title weighted 5x) per 1k words. */
function bestPageForTopic(pages: readonly EvalPage[], topic: PairwiseTopic): EvalPage {
	const keywordRes = topic.keywords.map(
		(kw) => new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
	);
	let best = pages[0];
	let bestScore = -1;
	for (const page of pages) {
		const content = page.content ?? "";
		const words = content.split(/\s+/).length || 1;
		let hits = 0;
		for (const re of keywordRes) {
			hits += (page.title.match(re)?.length ?? 0) * 5;
			hits += content.match(re)?.length ?? 0;
		}
		const score = (hits / words) * 1000;
		if (score > bestScore) {
			bestScore = score;
			best = page;
		}
	}
	return best;
}

function clip(content: string): string {
	if (content.length <= MAX_PAGE_CHARS) return content;
	return `${content.slice(0, MAX_PAGE_CHARS)}\n\n[page truncated for comparison]`;
}

async function judgeOnce(
	topic: PairwiseTopic,
	first: EvalPage,
	second: EvalPage,
): Promise<{ winner: "A" | "B" | "tie"; reason: string }> {
	const prompt = `You are comparing two wiki pages that document the same area of the same repository: "${topic.title}".

Judge which page better helps a developer understand how this part of the system ACTUALLY WORKS. Weigh, in order:
1. Behavioral depth — explains runtime behavior, data flow, edge cases, failure handling, and concrete defaults/limits/thresholds, rather than just inventorying files and functions.
2. Grounding — specifics look verifiable (real file paths, plausible values); penalize claims that look invented or vague hand-waving.
3. Connectedness — shows how this area interacts with the rest of the system.
4. Clarity — a competent developer can follow it.

Prose style and length alone must not decide the winner. Declare "tie" only if the pages are genuinely comparable on the criteria above.

## Page A: ${first.title}

${clip(first.content ?? "")}

## Page B: ${second.title}

${clip(second.content ?? "")}

Return your verdict.`;

	const result = await invokeGenerationModel({
		prompt,
		modelId: judgeModel,
		jsonSchema: VERDICT_SCHEMA,
		timeoutMs: 5 * 60 * 1000,
	});
	const out = result.structuredOutput as
		| { winner?: "A" | "B" | "tie"; reason?: string }
		| undefined;
	return { winner: out?.winner ?? "tie", reason: out?.reason ?? "no verdict returned" };
}

async function judgeTopic(topic: PairwiseTopic): Promise<TopicResult> {
	const pageA = bestPageForTopic(runA.pages, topic);
	const pageB = bestPageForTopic(runB.pages, topic);

	// Two orderings; map positional winners back to labels.
	const [o1, o2] = await Promise.all([
		judgeOnce(topic, pageA, pageB),
		judgeOnce(topic, pageB, pageA),
	]);
	const v1 = o1.winner === "A" ? labelA : o1.winner === "B" ? labelB : "tie";
	const v2 = o2.winner === "A" ? labelB : o2.winner === "B" ? labelA : "tie";

	const winner = v1 === v2 ? v1 : "tie";
	return {
		topicId: topic.id,
		title: topic.title,
		pageA: pageA.pageId,
		pageB: pageB.pageId,
		verdicts: [v1, v2],
		winner,
		reasons: [o1.reason, o2.reason],
	};
}

console.log(
	`Pairwise: ${labelA} vs ${labelB} — ${topics.length} topics x 2 orderings (judge: ${judgeModel})`,
);
const limit = pLimit(4);
const results = await Promise.all(topics.map((t) => limit(() => judgeTopic(t))));

const wins = (label: string): number => results.filter((r) => r.winner === label).length;
const ties = results.filter((r) => r.winner === "tie").length;

const summary = {
	labelA,
	labelB,
	judgeModel,
	judgedAt: new Date().toISOString(),
	tally: { [labelA]: wins(labelA), [labelB]: wins(labelB), tie: ties },
	topics: results,
};
const outPath = join(repoRoot, "evals", "results", `pairwise-${labelA}-vs-${labelB}.json`);
writeFileSync(outPath, JSON.stringify(summary, null, "\t"), "utf-8");

console.log(`\n=== Pairwise: ${labelA} vs ${labelB} ===\n`);
const width = Math.max(...results.map((r) => r.title.length));
for (const r of results) {
	console.log(
		`${r.title.padEnd(width)}  ${r.winner}${r.verdicts[0] !== r.verdicts[1] ? " (split)" : ""}`,
	);
}
console.log(`\nTally: ${labelA} ${wins(labelA)} · ${labelB} ${wins(labelB)} · tie ${ties}`);
console.log(`Saved: ${outPath}`);
