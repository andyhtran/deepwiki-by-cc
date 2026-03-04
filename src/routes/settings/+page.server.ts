import { CLAUDE_MODELS, config, getEffectiveConfig } from "$lib/server/config.js";
import { getAllSettings } from "$lib/server/db/settings.js";
import type { PageServerLoad } from "./$types.js";

export const load: PageServerLoad = async () => {
	const settings = getAllSettings();

	const defaultModels = Object.entries(CLAUDE_MODELS)
		.filter(([id]) => id === "claude-sonnet-4-6" || id === "claude-opus-4-6")
		.map(([id, info]) => ({
			id,
			name: info.name,
			input: info.input,
			output: info.output,
		}));

	const effective = getEffectiveConfig(settings);

	return {
		current: {
			generationModel: effective.generationModel,
			parallelPageLimit: effective.parallelPageLimit,
		},
		defaults: {
			generationModel: config.generationModel,
			parallelPageLimit: config.parallelPageLimit,
		},
		defaultModels,
	};
};
