import { json } from "@sveltejs/kit";
import { createJob } from "$lib/server/db/jobs.js";
import { getWikiById, getWikiPages } from "$lib/server/db/wikis.js";
import type { RequestHandler } from "./$types.js";

export const POST: RequestHandler = async ({ params }) => {
	const wikiId = Number(params.id);
	if (!wikiId || Number.isNaN(wikiId)) {
		return json({ error: "Invalid wiki ID" }, { status: 400 });
	}

	const wiki = getWikiById(wikiId);
	if (!wiki) {
		return json({ error: "Wiki not found" }, { status: 404 });
	}

	const pages = getWikiPages(wikiId);
	const failedPages = pages.filter(
		(p) => p.status === "failed" || p.status === "pending" || p.status === "generating",
	);

	if (failedPages.length === 0) {
		return json({ error: "No failed pages to resume" }, { status: 400 });
	}

	const job = createJob({
		type: "resume-generation",
		repo_id: wiki.repo_id!,
		params: { wikiId },
	});

	return json({
		jobId: job.id,
		failedPageCount: failedPages.length,
		totalPageCount: pages.length,
	});
};
