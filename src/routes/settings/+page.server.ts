import { config, GENERATION_MODELS, getEffectiveConfig } from "$lib/server/config.js";
import { getAllSettings } from "$lib/server/db/settings.js";
import type { PageServerLoad } from "./$types.js";

export const load: PageServerLoad = async () => {
	const settings = getAllSettings();

	const generationModels = Object.entries(GENERATION_MODELS).map(([id, info]) => ({
		id,
		name: info.name,
		input: info.input ?? null,
		output: info.output ?? null,
	}));

	const effective = getEffectiveConfig(settings);

	return {
		current: {
			generationModel: effective.generationModel,
			parallelPageLimit: effective.parallelPageLimit,
			display: effective.display,
		},
		defaults: {
			generationModel: config.generationModel,
			parallelPageLimit: config.parallelPageLimit,
			display: {
				showRepoOwner: config.showRepoOwner,
			},
		},
		generationModels,
	};
};
