import { json } from "@sveltejs/kit";
import { isGenerationModel } from "$lib/server/config.js";
import { setSetting } from "$lib/server/db/settings.js";
import type { RequestHandler } from "./$types.js";

export const PUT: RequestHandler = async ({ request }) => {
	const body = await request.json();

	if ("generationModel" in body) {
		const value = body.generationModel as string;
		if (isGenerationModel(value)) {
			setSetting("generationModel", value);
		}
	}

	if ("parallelPageLimit" in body) {
		const n = Number(body.parallelPageLimit);
		if (Number.isInteger(n) && n >= 1 && n <= 10) {
			setSetting("parallelPageLimit", String(n));
		}
	}

	if ("showRepoOwner" in body) {
		const value = body.showRepoOwner;
		if (typeof value === "boolean") {
			setSetting("showRepoOwner", value ? "true" : "false");
		} else if (value === "true" || value === "false") {
			setSetting("showRepoOwner", value);
		}
	}

	return json({ success: true });
};
