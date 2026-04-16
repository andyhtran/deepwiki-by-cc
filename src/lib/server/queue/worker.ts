import { killActiveClaudeProcesses } from "../ai/claude-cli.js";
import { killActiveCodexProcesses } from "../ai/codex-cli.js";
import {
	cancelJob,
	claimNextJob,
	completeJob,
	completeJobWithTokens,
	failJob,
	getJob,
	updateJobProgress,
} from "../db/jobs.js";
import { log } from "../logger.js";
import { handleFullGeneration, handleResumeGeneration, handleSync } from "./handlers.js";

let workerInterval: ReturnType<typeof setInterval> | null = null;
let processing = false;

// Abort controllers for in-progress jobs, keyed by job ID.
// When a cancel request arrives, we abort the controller so the handler
// can stop spawning new work (e.g. skip remaining pages).
const activeAborts = new Map<number, AbortController>();

/**
 * Request cancellation of a job. Marks it as cancelled in the DB and,
 * if it's currently being processed, signals the handler to stop.
 * Returns true if the job was found and cancelled.
 */
export function requestJobCancellation(jobId: number): boolean {
	const cancelled = cancelJob(jobId);
	if (!cancelled) return false;

	const controller = activeAborts.get(jobId);
	if (controller) {
		controller.abort();
		// Kill any in-flight CLI processes so the worker doesn't block
		// waiting for a long-running generation to finish.
		killActiveCodexProcesses();
		killActiveClaudeProcesses();
	}

	log.worker.info({ jobId }, "job cancelled");
	return true;
}

export function startWorker(): void {
	if (workerInterval) return;

	workerInterval = setInterval(async () => {
		if (processing) return;
		processing = true;

		try {
			const job = claimNextJob();
			if (!job) return;

			log.worker.info({ jobId: job.id, type: job.type }, "processing job");

			const abortController = new AbortController();
			activeAborts.set(job.id, abortController);

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
						totals = await handleFullGeneration(job, progressFn, abortController.signal);
						break;
					case "sync":
						totals = await handleSync(job, progressFn, abortController.signal);
						break;
					case "resume-generation":
						totals = await handleResumeGeneration(job, progressFn, abortController.signal);
						break;
					default:
						throw new Error(`Unknown job type: ${job.type}`);
				}

				// Check if the job was cancelled while processing.
				// The DB is the source of truth — the handler may have
				// finished naturally but cancellation arrived in between.
				const current = getJob(job.id);
				if (current?.status === "cancelled") {
					log.worker.info({ jobId: job.id }, "job was cancelled during processing");
				} else if (totals && (totals.promptTokens > 0 || totals.completionTokens > 0)) {
					completeJobWithTokens(job.id, totals);
				} else {
					completeJob(job.id);
				}
				log.worker.info({ jobId: job.id }, "job completed");
			} catch (error) {
				// Don't overwrite a cancellation with a failure status
				const current = getJob(job.id);
				if (current?.status !== "cancelled") {
					const message = error instanceof Error ? error.message : String(error);
					log.worker.error({ jobId: job.id, err: error }, "job failed");
					failJob(job.id, message);
				}
			} finally {
				activeAborts.delete(job.id);
			}
		} finally {
			processing = false;
		}
	}, 1000);
}
