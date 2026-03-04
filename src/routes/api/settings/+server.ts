import { json } from "@sveltejs/kit";
import { CLAUDE_MODELS } from "$lib/server/config.js";
import { setSetting } from "$lib/server/db/settings.js";
import type { RequestHandler } from "./$types.js";

export const PUT: RequestHandler = async ({ request }) => {
	const body = await request.json();

	if ("generationModel" in body) {
		const value = body.generationModel as string;
		if (value && value in CLAUDE_MODELS) {
			setSetting("generationModel", value);
		}
	}

	if ("parallelPageLimit" in body) {
		const n = Number(body.parallelPageLimit);
		if (Number.isInteger(n) && n >= 1 && n <= 10) {
			setSetting("parallelPageLimit", String(n));
		}
	}

	return json({ success: true });
};
