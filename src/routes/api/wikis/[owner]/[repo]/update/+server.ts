import { json } from "@sveltejs/kit";
import { getEffectiveConfig } from "$lib/server/config.js";
import { createJob, getActiveJobForRepo } from "$lib/server/db/jobs.js";
import { getRepoByFullName } from "$lib/server/db/repos.js";
import { getAllSettings } from "$lib/server/db/settings.js";
import { getWikiByRepo } from "$lib/server/db/wikis.js";
import type { RequestHandler } from "./$types.js";

export const POST: RequestHandler = async ({ params }) => {
	const fullName = `${params.owner}/${params.repo}`;
	const repo = getRepoByFullName(fullName);
	if (!repo) {
		return json({ error: "Repo not found" }, { status: 404 });
	}

	const wiki = getWikiByRepo(repo.id);
	if (!wiki) {
		return json({ error: "No wiki exists for this repo. Generate one first." }, { status: 404 });
	}

	const activeJob = getActiveJobForRepo(repo.id);
	if (activeJob) {
		return json({ jobId: activeJob.id, existing: true });
	}

	const effective = getEffectiveConfig(getAllSettings());

	const job = createJob({
		type: "sync",
		repo_id: repo.id,
		params: {
			owner: params.owner,
			repo: params.repo,
			generationModel: effective.generationModel,
		},
	});
	return json({ jobId: job.id });
};
