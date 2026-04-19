import pLimit from "p-limit";
import type { EmbeddingSnapshot, Job, WikiOutline } from "$lib/types.js";
import {
	type GenerationUsage,
	generateOutline,
	generatePage,
	generatePageUpdate,
} from "../ai/generator.js";
import { normalizeOutline } from "../ai/outline-normalizer.js";
import {
	calculateCost,
	type EffectiveEmbeddingConfig,
	getEffectiveConfig,
	resolveGenerationModel,
} from "../config.js";
import {
	deleteDocumentsByPaths,
	getDocumentsWithHashByRepo,
	getRepoFilePaths,
	insertDocument,
} from "../db/documents.js";
import { deleteEmbeddingDataByPaths } from "../db/embeddings.js";
import { updateJobParams, updateJobWikiId } from "../db/jobs.js";
import { createRepo, getRepo, updateRepo } from "../db/repos.js";
import { getAllSettings } from "../db/settings.js";
import {
	createWiki,
	createWikiPage,
	getWikiById,
	getWikiByRepo,
	getWikiPages,
	updateWiki,
	updateWikiPage,
} from "../db/wikis.js";
import { buildAnnIndex } from "../embeddings/ann.js";
import { createEndpointFingerprint } from "../embeddings/client.js";
import { refreshEmbeddingsForScannedFiles } from "../embeddings/indexer.js";
import { log } from "../logger.js";
import {
	cloneRepo,
	getDefaultBranch,
	getDiffSinceCommit,
	parseRepoInput,
	prepareLocalRepo,
} from "../pipeline/git.js";
import { buildFileTree, scanRepository } from "../pipeline/scanner.js";

type ProgressFn = (progress: number, message: string) => void;

/** Thrown when a job is cancelled mid-flight via the abort signal. */
class JobCancelledError extends Error {
	constructor() {
		super("Job cancelled");
		this.name = "JobCancelledError";
	}
}

/** Throws if the signal has been aborted (i.e. the job was cancelled). */
function throwIfCancelled(signal?: AbortSignal): void {
	if (signal?.aborted) throw new JobCancelledError();
}

function accumulateUsage(
	totals: { promptTokens: number; completionTokens: number; cost: number },
	usage: GenerationUsage,
): void {
	totals.promptTokens += usage.promptTokens;
	totals.completionTokens += usage.completionTokens;
	totals.cost += calculateCost(usage.modelId, usage.promptTokens, usage.completionTokens);
}

function buildEmbeddingSnapshot(embeddings: EffectiveEmbeddingConfig): EmbeddingSnapshot {
	if (!embeddings.enabled) {
		return { enabled: false, model: null, endpointFingerprint: null };
	}
	return {
		enabled: true,
		model: embeddings.model,
		endpointFingerprint: createEndpointFingerprint(embeddings.baseUrl),
	};
}

export async function handleFullGeneration(
	job: Job,
	progress: ProgressFn,
	signal?: AbortSignal,
): Promise<{
	promptTokens: number;
	completionTokens: number;
	cost: number;
}> {
	const params = (job.params ? JSON.parse(job.params) : {}) as Record<string, unknown>;
	const repoUrl = params.repoUrl as string;
	if (!repoUrl) throw new Error("Missing repoUrl in job params");

	const isLocal = params.isLocal === true;
	const localPath = params.localPath as string | undefined;

	const parsed = parseRepoInput(repoUrl);
	const totals = {
		promptTokens: 0,
		completionTokens: 0,
		cost: 0,
	};
	const generationStart = Date.now();

	const effective = getEffectiveConfig(getAllSettings());
	const generationModel = resolveGenerationModel(
		typeof params.generationModel === "string" ? params.generationModel : effective.generationModel,
	);
	const embeddingSnapshot = buildEmbeddingSnapshot(effective.embeddings);
	// Persist both generation model and embedding snapshot in job params
	updateJobParams(job.id, { ...params, generationModel, embeddingSnapshot });

	log.generation.info(
		{ repo: `${parsed.owner}/${parsed.name}`, model: generationModel },
		"starting full generation",
	);

	// Phase A: Clone or prepare local repo
	progress(2, `${isLocal ? "Preparing" : "Cloning"} ${parsed.owner}/${parsed.name}...`);
	const repo = createRepo({
		owner: parsed.owner,
		name: parsed.name,
		url: parsed.url,
	});
	let clonePath: string;
	let commitSha: string | null;

	if (isLocal && localPath) {
		const local = prepareLocalRepo(localPath);
		clonePath = local.clonePath;
		commitSha = local.commitSha;
	} else {
		const cloned = cloneRepo(parsed.owner, parsed.name);
		clonePath = cloned.clonePath;
		commitSha = cloned.commitSha;
	}

	const defaultBranch = isLocal ? "main" : getDefaultBranch(clonePath);
	const sourceType = isLocal ? "local" : "github";

	const skipDataPrep = commitSha != null && repo.last_commit_sha === commitSha;

	log.generation.info({ clonePath, commitSha: commitSha ?? "unknown" }, "clone ready");

	progress(
		3,
		skipDataPrep ? "Repository unchanged — reusing existing data" : "Scanning repository files...",
	);
	const files = scanRepository(clonePath);
	log.generation.info({ fileCount: files.length }, "scanned files");

	if (skipDataPrep) {
		updateRepo(repo.id, {
			clone_path: clonePath,
			default_branch: defaultBranch,
		});
		progress(8, "Reusing existing data");
	} else {
		updateRepo(repo.id, {
			clone_path: clonePath,
			last_commit_sha: commitSha,
			default_branch: defaultBranch,
		});

		const existingDocHashes = getDocumentsWithHashByRepo(repo.id);

		progress(5, `Storing ${files.length} files...`);
		for (const file of files) {
			const existing = existingDocHashes.get(file.filePath);
			if (existing && existing.content_hash === file.contentHash) {
				continue;
			}

			insertDocument({
				repo_id: repo.id,
				file_path: file.filePath,
				language: file.language,
				content: file.content,
				content_hash: file.contentHash,
			});
		}
	}

	if (effective.embeddings.enabled) {
		progress(9, "Refreshing embeddings index...");
		const embeddingSummary = await refreshEmbeddingsForScannedFiles({
			repoId: repo.id,
			files,
			embeddingConfig: effective.embeddings,
		});
		log.generation.info(
			{
				repoId: repo.id,
				considered: embeddingSummary.consideredFiles,
				indexed: embeddingSummary.indexedFiles,
				skipped: embeddingSummary.skippedFiles,
				failed: embeddingSummary.failedFiles.length,
			},
			"embedding refresh complete",
		);

		// Build/refresh ANN index for global retrieval
		buildAnnIndex(repo.id, effective.embeddings.model, effective.embeddings.baseUrl);
	}

	// Phase C: Generate wiki
	progress(10, "Generating wiki outline...");

	const fileTree = buildFileTree(files);
	const readme = files.find(
		(f) => f.filePath.toLowerCase() === "readme.md" || f.filePath.toLowerCase() === "readme",
	);
	const languages = [...new Set(files.filter((f) => f.language).map((f) => f.language!))];

	const { outline: rawOutline, usage: outlineUsage } = await generateOutline({
		repoName: `${parsed.owner}/${parsed.name}`,
		fileTree,
		readme: readme?.content || null,
		fileCount: files.length,
		languages,
		modelId: generationModel,
	});
	accumulateUsage(totals, outlineUsage);

	// Deterministic post-processing guards against model drift: dedupe
	// filePaths, drop hallucinated paths, inject entrypoints into code-starved
	// overviews, and clamp diagram suggestions.
	const outline = normalizeOutline(rawOutline, {
		files: files.map((f) => ({ filePath: f.filePath, language: f.language })),
	});

	log.generation.info(
		{
			sections: outline.sections.length,
			pages: outline.sections.reduce((n, s) => n + s.pages.length, 0),
		},
		"outline generated",
	);

	const wiki = createWiki({
		repo_id: repo.id,
		title: outline.title,
		description: outline.description,
		structure: JSON.stringify({
			title: outline.title,
			description: outline.description,
			sections: outline.sections.map((s) => ({
				id: s.id,
				title: s.title,
				pages: s.pages.map((p) => ({
					id: p.id,
					title: p.title,
					description: p.description,
					filePaths: p.filePaths,
					diagrams: p.diagrams,
				})),
			})),
		}),
		model: generationModel,
		source_type: sourceType,
		embedding_enabled: embeddingSnapshot.enabled ? 1 : 0,
		embedding_model: embeddingSnapshot.model,
		embedding_endpoint_fingerprint: embeddingSnapshot.endpointFingerprint,
	});

	updateJobWikiId(job.id, wiki.id);

	let sortOrder = 0;
	for (const section of outline.sections) {
		for (const page of section.pages) {
			createWikiPage({
				wiki_id: wiki.id,
				page_id: page.id,
				title: page.title,
				parent_id: section.id,
				sort_order: sortOrder++,
				file_paths: JSON.stringify(page.filePaths || []),
			});
		}
	}

	const wikiPagesAll = getWikiPages(wiki.id);
	const wikiPageMap = new Map(wikiPagesAll.map((wp) => [wp.page_id, wp]));

	const allPages = outline.sections.flatMap((s) =>
		s.pages.map((p) => ({ page: p, sectionTitle: s.title })),
	);
	const totalPages = allPages.length;
	let completedCount = 0;

	log.generation.info(
		{ concurrency: effective.parallelPageLimit, pages: totalPages },
		"generating pages",
	);
	const limit = pLimit(effective.parallelPageLimit);

	await Promise.all(
		allPages.map(({ page, sectionTitle }) =>
			limit(async () => {
				throwIfCancelled(signal);

				const wikiPage = wikiPageMap.get(page.id);
				if (!wikiPage) return;

				updateWikiPage(wikiPage.id, { status: "generating" });

				const startTime = Date.now();
				try {
					const { content, diagrams, usage } = await generatePage({
						repoId: repo.id,
						repoName: `${parsed.owner}/${parsed.name}`,
						repoUrl: parsed.url,
						defaultBranch,
						repoFiles: files.map((f) => f.filePath),
						page,
						sectionTitle,
						outline,
						generationModel,
					});

					const generationTimeMs = Date.now() - startTime;
					accumulateUsage(totals, usage);

					updateWikiPage(wikiPage.id, {
						content,
						diagrams: JSON.stringify(diagrams),
						status: "completed",
						prompt_tokens: usage.promptTokens,
						completion_tokens: usage.completionTokens,
						model: usage.modelId,
						generation_time_ms: generationTimeMs,
					});
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					log.generation.error({ page: page.title, err: msg }, "page generation failed");
					updateWikiPage(wikiPage.id, {
						status: "failed",
						error_message: msg,
						generation_time_ms: Date.now() - startTime,
					});
				}

				completedCount++;
				const pct = 15 + Math.floor((completedCount / totalPages) * 80);
				progress(pct, `Generated ${completedCount}/${totalPages} pages`);
				log.generation.info({ completed: completedCount, total: totalPages }, "progress");
			}),
		),
	);

	const generationDurationMs = Date.now() - generationStart;
	updateWiki(wiki.id, { status: "completed", generation_duration_ms: generationDurationMs });
	progress(95, "Wiki generation complete!");

	log.generation.info(
		{
			pages: totalPages,
			durationMs: generationDurationMs,
			promptTokens: totals.promptTokens,
			completionTokens: totals.completionTokens,
			costUsd: totals.cost,
		},
		"generation complete",
	);

	return totals;
}

export async function handleSync(
	job: Job,
	progress: ProgressFn,
	signal?: AbortSignal,
): Promise<{
	promptTokens: number;
	completionTokens: number;
	cost: number;
}> {
	const params = (job.params ? JSON.parse(job.params) : {}) as Record<string, unknown>;
	const owner = params.owner as string;
	const repoName = params.repo as string;
	const totals = {
		promptTokens: 0,
		completionTokens: 0,
		cost: 0,
	};
	const effective = getEffectiveConfig(getAllSettings());
	const generationModel = resolveGenerationModel(
		typeof params.generationModel === "string" ? params.generationModel : effective.generationModel,
	);
	const embeddingSnapshot = buildEmbeddingSnapshot(effective.embeddings);
	updateJobParams(job.id, { ...params, generationModel, embeddingSnapshot });

	if (!owner || !repoName) {
		throw new Error("Missing required params: owner, repo");
	}

	const repo = getRepo(job.repo_id!);
	if (!repo) throw new Error("Repo not found");

	const wiki = getWikiByRepo(repo.id);
	if (!wiki) throw new Error("No wiki found for this repo");

	// Link job to the wiki so per-version stats resolve correctly
	updateJobWikiId(job.id, wiki.id);

	if (!repo.last_commit_sha) {
		throw new Error("Repo has no last_commit_sha — regenerate the wiki first");
	}

	progress(10, "Pulling latest code...");
	const { clonePath, commitSha } = cloneRepo(owner, repoName);

	if (commitSha === repo.last_commit_sha) {
		progress(100, "Already up to date — no new commits");
		return totals;
	}

	progress(20, `Diffing ${repo.last_commit_sha.slice(0, 7)}..${commitSha.slice(0, 7)}...`);
	const diffResult = getDiffSinceCommit(clonePath, repo.last_commit_sha);

	const changedFiles = diffResult.files.map((f) => f.path);
	if (changedFiles.length === 0) {
		updateRepo(repo.id, { clone_path: clonePath, last_commit_sha: commitSha });
		progress(100, "No files changed");
		return totals;
	}

	const shortSha = repo.last_commit_sha.slice(0, 7);
	const changeTitle = `Sync: ${diffResult.commitCount} commit${diffResult.commitCount === 1 ? "" : "s"} since ${shortSha}`;

	await rescanChangedFiles(repo.id, clonePath, changedFiles, effective.embeddings, progress);

	const wikiOutline = JSON.parse(wiki.structure) as WikiOutline;
	const { buildOutlineSummary } = await import("../ai/generator.js");
	const outlineSummary = buildOutlineSummary(wikiOutline);

	// Include commit messages so the update prompt has semantic context about what changed
	const fileSummary = `${changedFiles.length} files changed across ${diffResult.commitCount} commits`;
	const changeDescription = diffResult.commitLog
		? `${fileSummary}\n\nRecent commits:\n${diffResult.commitLog}`
		: fileSummary;

	const result = await updateAffectedPages(
		repo.id,
		wiki,
		changedFiles,
		changeTitle,
		changeDescription,
		diffResult.diff,
		`${owner}/${repoName}`,
		repo.url,
		repo.default_branch,
		getRepoFilePaths(repo.id),
		outlineSummary,
		generationModel,
		effective.parallelPageLimit,
		totals,
		progress,
		signal,
	);

	updateRepo(repo.id, { clone_path: clonePath, last_commit_sha: commitSha });

	return result;
}

async function rescanChangedFiles(
	repoId: number,
	clonePath: string,
	changedFiles: string[],
	embeddingConfig: ReturnType<typeof getEffectiveConfig>["embeddings"],
	progress: ProgressFn,
): Promise<void> {
	progress(30, `Re-scanning ${changedFiles.length} changed files...`);
	deleteDocumentsByPaths(repoId, changedFiles);
	deleteEmbeddingDataByPaths(repoId, changedFiles);

	const { scanRepository: scan } = await import("../pipeline/scanner.js");
	const allFiles = scan(clonePath);
	const changedScanned = allFiles.filter((f) => changedFiles.includes(f.filePath));

	for (const file of changedScanned) {
		insertDocument({
			repo_id: repoId,
			file_path: file.filePath,
			language: file.language,
			content: file.content,
			content_hash: file.contentHash,
		});
	}

	if (!embeddingConfig.enabled || changedScanned.length === 0) return;

	progress(40, "Refreshing embeddings for changed files...");
	const embeddingSummary = await refreshEmbeddingsForScannedFiles({
		repoId,
		files: changedScanned,
		embeddingConfig,
	});
	log.generation.info(
		{
			repoId,
			considered: embeddingSummary.consideredFiles,
			indexed: embeddingSummary.indexedFiles,
			skipped: embeddingSummary.skippedFiles,
			failed: embeddingSummary.failedFiles.length,
		},
		"sync embedding refresh complete",
	);

	// Rebuild ANN index after sync updates
	buildAnnIndex(repoId, embeddingConfig.model, embeddingConfig.baseUrl);
}

async function updateAffectedPages(
	repoId: number,
	wiki: { id: number },
	changedFiles: string[],
	title: string,
	body: string,
	diff: string,
	repoName: string,
	repoUrl: string,
	defaultBranch: string,
	repoFiles: readonly string[],
	outlineSummary: string,
	generationModel: string,
	parallelPageLimit: number,
	totals: {
		promptTokens: number;
		completionTokens: number;
		cost: number;
	},
	progress: ProgressFn,
	signal?: AbortSignal,
): Promise<typeof totals> {
	progress(60, "Identifying affected wiki pages...");
	const wikiPages = getWikiPages(wiki.id);

	const changedSet = new Set(changedFiles);
	const allAffected = wikiPages.filter((wp) => {
		if (!wp.file_paths) return false;
		const pagePaths = JSON.parse(wp.file_paths) as string[];
		return pagePaths.some((p) => changedSet.has(p));
	});

	if (allAffected.length === 0) {
		progress(100, "No wiki pages affected");
		return totals;
	}

	const totalAffected = allAffected.length;
	let completedCount = 0;
	log.generation.info(
		{ concurrency: parallelPageLimit, pages: totalAffected, model: generationModel },
		"updating pages",
	);
	const limit = pLimit(parallelPageLimit);

	await Promise.all(
		allAffected.map((page) =>
			limit(async () => {
				throwIfCancelled(signal);

				if (!page.content) {
					completedCount++;
					return;
				}

				const filePaths = page.file_paths ? (JSON.parse(page.file_paths) as string[]) : [];

				const startTime = Date.now();
				try {
					const {
						content: updatedContent,
						diagrams: updatedDiagrams,
						usage,
					} = await generatePageUpdate({
						repoId,
						repoName,
						repoUrl,
						defaultBranch,
						repoFiles,
						changeTitle: title,
						changeDescription: body,
						changeDiff: diff,
						currentPageContent: page.content,
						pageTitle: page.title,
						filePaths,
						outline: outlineSummary,
						generationModel,
					});

					const generationTimeMs = Date.now() - startTime;
					accumulateUsage(totals, usage);

					// Always update page metadata (model, tokens, time, status) even
					// when the LLM returns no content changes — so stats stay accurate
					// for the current generation run.
					const pageUpdate: Parameters<typeof updateWikiPage>[1] = {
						model: usage.modelId,
						prompt_tokens: usage.promptTokens,
						completion_tokens: usage.completionTokens,
						generation_time_ms: generationTimeMs,
						status: "completed" as const,
						error_message: null,
					};

					if (updatedContent) {
						pageUpdate.content = updatedContent;
						pageUpdate.diagrams = JSON.stringify(updatedDiagrams);
					}

					updateWikiPage(page.id, pageUpdate);
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					log.generation.error({ page: page.title, err: msg }, "page update failed");
					updateWikiPage(page.id, {
						status: "failed",
						error_message: msg,
						generation_time_ms: Date.now() - startTime,
					});
				}

				completedCount++;
				const pct = 65 + Math.floor((completedCount / totalAffected) * 30);
				progress(pct, `Updated ${completedCount}/${totalAffected} pages`);
			}),
		),
	);

	updateWiki(wiki.id, { status: "completed" });
	progress(95, "Update complete!");

	return totals;
}

export async function handleResumeGeneration(
	job: Job,
	progress: ProgressFn,
	signal?: AbortSignal,
): Promise<{
	promptTokens: number;
	completionTokens: number;
	cost: number;
}> {
	const params = (job.params ? JSON.parse(job.params) : {}) as Record<string, unknown>;
	const wikiId = params.wikiId as number;
	if (!wikiId) throw new Error("Missing wikiId in job params");

	const wiki = getWikiById(wikiId);
	if (!wiki) throw new Error(`Wiki ${wikiId} not found`);

	const repo = wiki.repo_id ? getRepo(wiki.repo_id) : undefined;
	if (!repo) throw new Error(`Repo not found for wiki ${wikiId}`);

	const totals = {
		promptTokens: 0,
		completionTokens: 0,
		cost: 0,
	};

	const effective = getEffectiveConfig(getAllSettings());
	const generationModel = resolveGenerationModel(
		typeof params.generationModel === "string" ? params.generationModel : effective.generationModel,
	);
	const embeddingSnapshot = buildEmbeddingSnapshot(effective.embeddings);
	updateJobParams(job.id, { ...params, generationModel, embeddingSnapshot });

	const outline = JSON.parse(wiki.structure) as WikiOutline;
	const repoFilePaths = getRepoFilePaths(repo.id);

	const allWikiPages = getWikiPages(wiki.id);
	const failedPages = allWikiPages.filter(
		(p) => p.status === "failed" || p.status === "pending" || p.status === "generating",
	);

	if (failedPages.length === 0) {
		progress(100, "No failed pages to resume");
		return totals;
	}

	log.resume.info({ wikiId, failed: failedPages.length, total: allWikiPages.length }, "resuming");
	progress(5, `Resuming ${failedPages.length} failed pages...`);

	updateJobWikiId(job.id, wiki.id);
	updateWiki(wiki.id, { status: "generating" });

	const allPages = outline.sections.flatMap((s) =>
		s.pages.map((p) => ({ page: p, sectionTitle: s.title })),
	);

	const failedPageIds = new Set(failedPages.map((p) => p.page_id));
	const pagesToRetry = allPages.filter(({ page }) => failedPageIds.has(page.id));

	const totalPages = pagesToRetry.length;
	let completedCount = 0;

	log.resume.info(
		{ concurrency: effective.parallelPageLimit, pages: totalPages },
		"resuming pages",
	);
	const limit = pLimit(effective.parallelPageLimit);

	await Promise.all(
		pagesToRetry.map(({ page, sectionTitle }) =>
			limit(async () => {
				throwIfCancelled(signal);

				const wikiPage = allWikiPages.find((wp) => wp.page_id === page.id);
				if (!wikiPage) return;

				updateWikiPage(wikiPage.id, { status: "generating", error_message: null });

				const startTime = Date.now();
				try {
					const { content, diagrams, usage } = await generatePage({
						repoId: repo.id,
						repoName: `${repo.owner}/${repo.name}`,
						repoUrl: repo.url,
						defaultBranch: repo.default_branch,
						repoFiles: repoFilePaths,
						page,
						sectionTitle,
						outline,
						generationModel,
					});

					const generationTimeMs = Date.now() - startTime;
					accumulateUsage(totals, usage);

					updateWikiPage(wikiPage.id, {
						content,
						diagrams: JSON.stringify(diagrams),
						status: "completed",
						prompt_tokens: usage.promptTokens,
						completion_tokens: usage.completionTokens,
						model: usage.modelId,
						generation_time_ms: generationTimeMs,
					});
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					log.resume.error({ page: page.title, err: msg }, "page generation failed");
					updateWikiPage(wikiPage.id, {
						status: "failed",
						error_message: msg,
						generation_time_ms: Date.now() - startTime,
					});
				}

				completedCount++;
				const pct = 5 + Math.floor((completedCount / totalPages) * 90);
				progress(pct, `Resumed ${completedCount}/${totalPages} pages`);
			}),
		),
	);

	const remainingFailed = getWikiPages(wiki.id).filter((p) => p.status === "failed");
	if (remainingFailed.length > 0) {
		log.resume.warn({ remaining: remainingFailed.length }, "pages still failed after resume");
	}

	updateWiki(wiki.id, { status: "completed" });
	progress(100, "Resume complete!");

	return totals;
}
