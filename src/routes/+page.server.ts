import { getEffectiveDisplayConfig } from "$lib/server/config.js";
import { getActiveJobs } from "$lib/server/db/jobs.js";
import { getAllSettings } from "$lib/server/db/settings.js";
import { listWikis } from "$lib/server/db/wikis.js";
import type { PageServerLoad } from "./$types.js";

export const load: PageServerLoad = async () => {
	const settings = getAllSettings();

	return {
		activeJobs: getActiveJobs(),
		display: getEffectiveDisplayConfig(settings),
		wikis: listWikis(),
	};
};
