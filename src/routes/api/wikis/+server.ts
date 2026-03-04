import { json } from "@sveltejs/kit";
import { listWikis } from "$lib/server/db/wikis.js";
import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = async () => {
	const wikis = listWikis();
	return json(wikis);
};
