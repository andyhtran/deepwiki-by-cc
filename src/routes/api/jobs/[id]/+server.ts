import { json } from "@sveltejs/kit";
import { getJob } from "$lib/server/db/jobs.js";
import { requestJobCancellation } from "$lib/server/queue/worker.js";
import type { RequestHandler } from "./$types.js";

export const DELETE: RequestHandler = async ({ params }) => {
	const jobId = Number.parseInt(params.id, 10);
	if (Number.isNaN(jobId)) {
		return new Response("Invalid job ID", { status: 400 });
	}

	const cancelled = requestJobCancellation(jobId);
	if (!cancelled) {
		const job = getJob(jobId);
		if (!job) return new Response("Job not found", { status: 404 });
		return json({ message: "Job is not cancellable", status: job.status }, { status: 409 });
	}

	return json({ message: "Job cancelled" });
};

export const GET: RequestHandler = async ({ params }) => {
	const jobId = Number.parseInt(params.id, 10);
	if (Number.isNaN(jobId)) {
		return new Response("Invalid job ID", { status: 400 });
	}

	const job = getJob(jobId);
	if (!job) {
		return new Response("Job not found", { status: 404 });
	}

	if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
		const statusMessage =
			job.status === "failed"
				? job.error_message
				: job.status === "cancelled"
					? "Cancelled"
					: "Completed";
		const data = JSON.stringify({
			status: job.status,
			progress: job.progress,
			message: statusMessage,
		});

		return new Response(`data: ${data}\n\n`, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		});
	}

	let pollInterval: ReturnType<typeof setInterval>;

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();
			let lastProgress = -1;
			let lastMessage = "";

			const send = (status: string, progress: number, message: string) => {
				const data = JSON.stringify({ status, progress: Math.max(0, progress), message });
				controller.enqueue(encoder.encode(`data: ${data}\n\n`));
			};

			const p = job.progress ?? 0;
			const m = job.progress_message || "Starting...";
			send(job.status, p, m);
			lastProgress = p;
			lastMessage = m;

			// Poll DB for updates instead of relying on in-memory pub/sub
			// (survives Vite HMR module reloads)
			pollInterval = setInterval(() => {
				try {
					const current = getJob(jobId);
					if (!current) {
						clearInterval(pollInterval);
						try {
							controller.close();
						} catch {}
						return;
					}

					const cp = current.progress ?? 0;
					const cm = current.progress_message || "";

					if (cp !== lastProgress || cm !== lastMessage) {
						lastProgress = cp;
						lastMessage = cm;
						send(
							current.status,
							cp,
							cm || (current.status === "completed" ? "Completed" : "Processing..."),
						);
					}

					if (
						current.status === "completed" ||
						current.status === "failed" ||
						current.status === "cancelled"
					) {
						if (cp !== 100 && current.status === "completed") {
							send("completed", 100, "Completed");
						}
						if (current.status === "failed" && cm !== current.error_message) {
							send("failed", cp, current.error_message ?? "Failed");
						}
						if (current.status === "cancelled") {
							send("cancelled", cp, "Cancelled");
						}
						clearInterval(pollInterval);
						setTimeout(() => {
							try {
								controller.close();
							} catch {}
						}, 100);
					}
				} catch {
					clearInterval(pollInterval);
					try {
						controller.close();
					} catch {}
				}
			}, 500);
		},
		cancel() {
			clearInterval(pollInterval);
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
};
