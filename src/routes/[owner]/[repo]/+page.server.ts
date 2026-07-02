import { error, redirect } from "@sveltejs/kit";
import { getEffectiveDisplayConfig } from "$lib/server/config.js";
import { getDb } from "$lib/server/db/index.js";
import { getAllSettings } from "$lib/server/db/settings.js";
import {
	getWikiByOwnerRepo,
	getWikiByOwnerRepoVersion,
	getWikiPages,
	getWikisByOwnerRepo,
} from "$lib/server/db/wikis.js";
import type { Job } from "$lib/types.js";
import { buildWikiPagePath, resolveWikiPageSlug } from "$lib/wiki-page-slugs.js";
import type { PageServerLoad } from "./$types.js";

export const load: PageServerLoad = async ({ params, url }) => {
	const settings = getAllSettings();
	const versionId = url.searchParams.get("v");
	const pageSlug = (params as typeof params & { pageSlug?: string }).pageSlug ?? null;

	// Without ?v=, show the latest version
	const latest = getWikiByOwnerRepo(params.owner, params.repo);

	let wiki;
	if (versionId) {
		// Look up by version number scoped to this owner/repo (prevents cross-repo leaks)
		wiki = getWikiByOwnerRepoVersion(params.owner, params.repo, Number(versionId));
		if (!wiki) {
			throw error(404, "Wiki version not found");
		}
		// If ?v= points to the latest version, redirect to the clean URL
		if (latest && wiki.id === latest.id) {
			throw redirect(302, buildWikiPagePath({ owner: params.owner, repo: params.repo, pageSlug }));
		}
	} else {
		wiki = latest;
		if (!wiki) {
			throw error(404, "Wiki not found");
		}
	}

	const pages = getWikiPages(wiki.id);
	const structure = JSON.parse(wiki.structure);

	if (pageSlug) {
		const resolvedPage = resolveWikiPageSlug(structure, pageSlug);
		if (!resolvedPage) {
			throw redirect(
				302,
				buildWikiPagePath({
					owner: params.owner,
					repo: params.repo,
					version: versionId,
				}),
			);
		}

		if (pageSlug !== resolvedPage.slug) {
			throw redirect(
				302,
				buildWikiPagePath({
					owner: params.owner,
					repo: params.repo,
					pageSlug: resolvedPage.slug,
					version: versionId,
				}),
			);
		}
	}

	const versions = getWikisByOwnerRepo(params.owner, params.repo);

	const db = getDb();

	let activeJobId: number | null = null;
	if (wiki.status === "generating") {
		const activeJob = db
			.prepare(
				`SELECT id FROM jobs
				 WHERE wiki_id = ?
				   AND status IN ('pending', 'processing')
				 ORDER BY created_at DESC LIMIT 1`,
			)
			.get(wiki.id) as { id: number } | undefined;
		if (activeJob) {
			activeJobId = activeJob.id;
		}
	}

	const repo = wiki.repo_id
		? (db
				.prepare("SELECT default_branch, last_commit_sha FROM repos WHERE id = ?")
				.get(wiki.repo_id) as
				| {
						default_branch: string;
						last_commit_sha: string | null;
				  }
				| undefined)
		: undefined;

	// Fetch the completed job for this specific wiki version (not just latest by repo)
	const job = db
		.prepare(
			`SELECT * FROM jobs
			 WHERE wiki_id = ?
			   AND status = 'completed'
			 ORDER BY completed_at DESC LIMIT 1`,
		)
		.get(wiki.id) as Job | undefined;

	return {
		wiki: {
			...wiki,
			structure,
		},
		pages: pages.map((p) => ({
			...p,
			diagrams: p.diagrams ? JSON.parse(p.diagrams) : [],
			file_paths: p.file_paths ? JSON.parse(p.file_paths) : [],
		})),
		owner: params.owner,
		repo: params.repo,
		pageSlug,
		versions: versions.map((v) => ({
			id: v.id,
			version: v.version,
			model: v.model,
			status: v.status,
			page_count: v.page_count,
			created_at: v.created_at,
		})),
		currentVersion: wiki.version,
		activeJobId,
		defaultBranch: repo?.default_branch ?? "main",
		display: getEffectiveDisplayConfig(settings),
		lastIndexedSha: repo?.last_commit_sha ?? null,
		// "Last indexed" means when THIS wiki version finished generating, not
		// when the repos row was last touched (which refreshes on unrelated
		// updates like clone_path changes or `/api/generate` upserts). Prefer
		// the wiki's completed job timestamp; fall back to wiki.updated_at.
		lastIndexedAt: job?.completed_at ?? wiki.updated_at ?? null,
		jobStats: job
			? {
					totalPromptTokens: job.total_prompt_tokens,
					totalCompletionTokens: job.total_completion_tokens,
					totalCost: job.total_cost,
					startedAt: job.started_at,
					completedAt: job.completed_at,
				}
			: null,
	};
};
