import { json } from "@sveltejs/kit";
import { getActiveJobs } from "$lib/server/db/jobs.js";
import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = async () => {
	return json(getActiveJobs());
};
