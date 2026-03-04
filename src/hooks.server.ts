import { getDb } from "$lib/server/db/index.js";
import { resetProcessingJobs } from "$lib/server/db/jobs.js";
import { log } from "$lib/server/logger.js";
import { startWorker } from "$lib/server/queue/worker.js";

try {
	getDb();
	const reset = resetProcessingJobs();
	if (reset > 0) {
		log.startup.info({ reset }, "reset processing jobs to pending");
	}
	startWorker();
	log.startup.info("worker started");
} catch (error) {
	log.startup.error({ err: error }, "failed to initialize");
}
