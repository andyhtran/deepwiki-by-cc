import { getActiveJobs } from "$lib/server/db/jobs.js";
import { listWikis } from "$lib/server/db/wikis.js";
import type { PageServerLoad } from "./$types.js";

export const load: PageServerLoad = async () => {
	return {
		activeJobs: getActiveJobs(),
		wikis: listWikis(),
	};
};
