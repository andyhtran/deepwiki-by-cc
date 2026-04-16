import { getDb } from "$lib/server/db/index.js";
import { cancelStaleJobs } from "$lib/server/db/jobs.js";
import { log } from "$lib/server/logger.js";
import { startWorker } from "$lib/server/queue/worker.js";

try {
	getDb();
	const cancelled = cancelStaleJobs();
	if (cancelled > 0) {
		log.startup.info({ cancelled }, "cancelled stale jobs from previous run");
	}
	startWorker();
	log.startup.info("worker started");
} catch (error) {
	log.startup.error({ err: error }, "failed to initialize");
}
