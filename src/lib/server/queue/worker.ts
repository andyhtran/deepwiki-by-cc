import {
	claimNextJob,
	completeJob,
	completeJobWithTokens,
	failJob,
	updateJobProgress,
} from "../db/jobs.js";
import { log } from "../logger.js";
import { handleFullGeneration, handleResumeGeneration, handleSync } from "./handlers.js";

let workerInterval: ReturnType<typeof setInterval> | null = null;
let processing = false;

export function startWorker(): void {
	if (workerInterval) return;

	workerInterval = setInterval(async () => {
		if (processing) return;
		processing = true;

		try {
			const job = claimNextJob();
			if (!job) return;

			log.worker.info({ jobId: job.id, type: job.type }, "processing job");

			const progressFn = (progress: number, message: string) => {
				updateJobProgress(job.id, progress, message);
			};

			try {
				let totals:
					| {
							promptTokens: number;
							completionTokens: number;
							cost: number;
					  }
					| undefined;

				switch (job.type) {
					case "full-generation":
						totals = await handleFullGeneration(job, progressFn);
						break;
					case "sync":
						totals = await handleSync(job, progressFn);
						break;
					case "resume-generation":
						totals = await handleResumeGeneration(job, progressFn);
						break;
					default:
						throw new Error(`Unknown job type: ${job.type}`);
				}

				if (totals && (totals.promptTokens > 0 || totals.completionTokens > 0)) {
					completeJobWithTokens(job.id, totals);
				} else {
					completeJob(job.id);
				}
				log.worker.info({ jobId: job.id }, "job completed");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				log.worker.error({ jobId: job.id, err: error }, "job failed");
				failJob(job.id, message);
			}
		} finally {
			processing = false;
		}
	}, 1000);
}
