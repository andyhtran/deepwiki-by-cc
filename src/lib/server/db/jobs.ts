import type { Job } from "$lib/types.js";
import { getDb } from "./index.js";

export function createJob(data: {
	type: "full-generation" | "sync" | "resume-generation";
	repo_id: number;
	params?: Record<string, unknown>;
}): Job {
	const db = getDb();
	const stmt = db.prepare(`
		INSERT INTO jobs (type, repo_id, params)
		VALUES (?, ?, ?)
		RETURNING *
	`);
	return stmt.get(data.type, data.repo_id, data.params ? JSON.stringify(data.params) : null) as Job;
}

export function getJob(id: number): Job | undefined {
	const db = getDb();
	return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Job | undefined;
}

export function claimNextJob(): Job | undefined {
	const db = getDb();
	return db
		.prepare(
			`UPDATE jobs SET status = 'processing', started_at = datetime('now')
			 WHERE id = (
				SELECT id FROM jobs WHERE status = 'pending' ORDER BY created_at LIMIT 1
			 )
			 RETURNING *`,
		)
		.get() as Job | undefined;
}

export function updateJobProgress(id: number, progress: number, message?: string): void {
	const db = getDb();
	db.prepare("UPDATE jobs SET progress = ?, progress_message = ? WHERE id = ?").run(
		progress,
		message || null,
		id,
	);
}

export function completeJob(id: number): void {
	const db = getDb();
	db.prepare(
		"UPDATE jobs SET status = 'completed', progress = 100, completed_at = datetime('now') WHERE id = ?",
	).run(id);
}

export function completeJobWithTokens(
	id: number,
	tokens: {
		promptTokens: number;
		completionTokens: number;
		cost: number;
	},
): void {
	const db = getDb();
	db.prepare(
		`UPDATE jobs SET
			status = 'completed',
			progress = 100,
			completed_at = datetime('now'),
			total_prompt_tokens = ?,
			total_completion_tokens = ?,
			total_cost = ?
		WHERE id = ?`,
	).run(tokens.promptTokens, tokens.completionTokens, tokens.cost, id);
}

export function failJob(id: number, error: string): void {
	const db = getDb();
	db.prepare(
		"UPDATE jobs SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?",
	).run(error, id);
}

/** Cancel a pending or processing job. Returns true if the job was actually updated. */
export function cancelJob(id: number): boolean {
	const db = getDb();
	const result = db
		.prepare(
			"UPDATE jobs SET status = 'cancelled', completed_at = datetime('now') WHERE id = ? AND status IN ('pending', 'processing')",
		)
		.run(id);
	return result.changes > 0;
}

export function updateJobWikiId(jobId: number, wikiId: number): void {
	const db = getDb();
	db.prepare("UPDATE jobs SET wiki_id = ? WHERE id = ?").run(wikiId, jobId);
}

export function updateJobParams(jobId: number, params: Record<string, unknown>): void {
	const db = getDb();
	db.prepare("UPDATE jobs SET params = ? WHERE id = ?").run(JSON.stringify(params), jobId);
}

export function getActiveJobForRepo(repoId: number): Job | undefined {
	const db = getDb();
	return db
		.prepare(
			"SELECT * FROM jobs WHERE repo_id = ? AND status IN ('pending', 'processing') ORDER BY created_at DESC LIMIT 1",
		)
		.get(repoId) as Job | undefined;
}

export interface ActiveJobInfo {
	id: number;
	type: string;
	status: "pending" | "processing";
	progress: number;
	progress_message: string | null;
	repo_name: string;
	created_at: string;
}

export function getActiveJobs(): ActiveJobInfo[] {
	const db = getDb();
	return db
		.prepare(
			`SELECT j.id, j.type, j.status, j.progress, j.progress_message,
				r.owner || '/' || r.name as repo_name, j.created_at
			 FROM jobs j
			 LEFT JOIN repos r ON r.id = j.repo_id
			 WHERE j.status IN ('pending', 'processing')
			 ORDER BY j.created_at ASC`,
		)
		.all() as ActiveJobInfo[];
}

/**
 * Cancel any jobs that were still in-flight when server shut down.
 * Previously these were re-queued as 'pending', which caused unexpected
 * auto-restarts after a deploy. Cancelling is safer — the user can
 * explicitly resume if they want to retry.
 */
export function cancelStaleJobs(): number {
	const db = getDb();
	const result = db
		.prepare(
			"UPDATE jobs SET status = 'cancelled', completed_at = datetime('now') WHERE status IN ('pending', 'processing')",
		)
		.run();
	return result.changes;
}
