import { json } from "@sveltejs/kit";
import { createJob, getActiveJobForRepo } from "$lib/server/db/jobs.js";
import { getRepoByFullName } from "$lib/server/db/repos.js";
import { getCompletedWikiByRepo } from "$lib/server/db/wikis.js";
import { parseRepoInput } from "$lib/server/pipeline/git.js";
import type { RequestHandler } from "./$types.js";

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const repoUrl = body.repoUrl as string;
	const force = body.force === true;

	if (!repoUrl) {
		return json({ error: "repoUrl is required" }, { status: 400 });
	}

	let parsed;
	try {
		parsed = parseRepoInput(repoUrl);
	} catch (err) {
		return json(
			{ error: err instanceof Error ? err.message : "Invalid repository input" },
			{ status: 400 },
		);
	}

	const fullName = `${parsed.owner}/${parsed.name}`;
	const existing = getRepoByFullName(fullName);
	if (existing) {
		const activeJob = getActiveJobForRepo(existing.id);
		if (activeJob) {
			return json({ jobId: activeJob.id, repoName: fullName, existing: true });
		}
	}

	const { createRepo } = await import("$lib/server/db/repos.js");
	const repo = createRepo({
		owner: parsed.owner,
		name: parsed.name,
		url: parsed.url,
	});

	// Unless force is set, check for an existing completed wiki and prompt the user
	if (!force) {
		const existingWiki = getCompletedWikiByRepo(repo.id);
		if (existingWiki) {
			return json({
				existingWiki: true,
				repoName: fullName,
				owner: parsed.owner,
				repo: parsed.name,
				version: existingWiki.version,
			});
		}
	}

	const params: Record<string, unknown> = { repoUrl };
	if (parsed.isLocal) {
		params.isLocal = true;
		params.localPath = parsed.localPath;
	}

	const job = createJob({
		type: "full-generation",
		repo_id: repo.id,
		params,
	});

	return json({ jobId: job.id, repoName: fullName });
};
