import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { json } from "@sveltejs/kit";
import { config } from "$lib/server/config.js";
import { deleteDocumentsByRepo } from "$lib/server/db/documents.js";
import { deleteRepo, getRepo } from "$lib/server/db/repos.js";
import { deleteWikiById, getWikiById, getWikiByRepo } from "$lib/server/db/wikis.js";
import type { RequestHandler } from "./$types.js";

function isSafeToDelete(clonePath: string): boolean {
	const resolved = resolve(clonePath);
	const reposDir = resolve(config.dataDir, "repos");
	return resolved.startsWith(`${reposDir}/`);
}

export const DELETE: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	if (!id || Number.isNaN(id)) {
		return json({ error: "Invalid wiki ID" }, { status: 400 });
	}

	const wiki = getWikiById(id);
	if (!wiki) {
		return json({ error: "Wiki not found" }, { status: 404 });
	}

	deleteWikiById(id);

	if (wiki.repo_id) {
		const remaining = getWikiByRepo(wiki.repo_id);
		if (!remaining) {
			const repo = getRepo(wiki.repo_id);
			deleteDocumentsByRepo(wiki.repo_id);
			if (repo?.clone_path && wiki.source_type !== "local" && isSafeToDelete(repo.clone_path)) {
				try {
					rmSync(repo.clone_path, { recursive: true, force: true });
				} catch {
					// Directory may already be gone
				}
			}
			deleteRepo(wiki.repo_id);
		}
	}

	return json({ success: true });
};
