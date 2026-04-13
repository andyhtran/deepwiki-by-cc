import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { config } from "../config.js";

interface ParsedRepo {
	owner: string;
	name: string;
	url: string;
	isLocal: boolean;
	localPath?: string;
}

export function isLocalPath(input: string): boolean {
	const trimmed = input.trim();
	return (
		trimmed.startsWith("/") ||
		trimmed.startsWith("~") ||
		trimmed.startsWith("./") ||
		trimmed.startsWith("../")
	);
}

function parseLocalPath(input: string): ParsedRepo {
	let resolved = input.trim();

	if (resolved.startsWith("~")) {
		resolved = join(homedir(), resolved.slice(1));
	}

	resolved = resolve(resolved);

	try {
		resolved = realpathSync(resolved);
	} catch {
		throw new Error(`Path does not exist: ${resolved}`);
	}

	const stat = statSync(resolved);
	if (!stat.isDirectory()) {
		throw new Error(`Not a directory: ${resolved}`);
	}

	const name = basename(resolved);
	return {
		owner: "local",
		name,
		url: `local://${resolved}`,
		isLocal: true,
		localPath: resolved,
	};
}

export const GITHUB_NAME_RE = /^[a-zA-Z0-9._-]+$/;

function validateGitHubName(owner: string, name: string, input: string): void {
	if (!GITHUB_NAME_RE.test(owner) || !GITHUB_NAME_RE.test(name)) {
		throw new Error(`Invalid repository URL: ${input}`);
	}
}

export function parseRepoUrl(input: string): ParsedRepo {
	// Handle formats:
	// https://github.com/owner/repo
	// https://github.com/owner/repo.git
	// github.com/owner/repo
	// owner/repo
	const cleaned = input
		.trim()
		.replace(/\.git$/, "")
		.replace(/\/$/, "");

	const fullUrlMatch = cleaned.match(/(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+)/);
	if (fullUrlMatch) {
		const [, owner, name] = fullUrlMatch;
		validateGitHubName(owner, name, input);
		return {
			owner,
			name,
			url: `https://github.com/${owner}/${name}`,
			isLocal: false,
		};
	}

	const shortMatch = cleaned.match(/^([^/]+)\/([^/]+)$/);
	if (shortMatch) {
		const [, owner, name] = shortMatch;
		validateGitHubName(owner, name, input);
		return {
			owner,
			name,
			url: `https://github.com/${owner}/${name}`,
			isLocal: false,
		};
	}

	throw new Error(`Invalid repository URL: ${input}`);
}

export function parseRepoInput(input: string): ParsedRepo {
	if (isLocalPath(input)) {
		return parseLocalPath(input);
	}
	return parseRepoUrl(input);
}

export function prepareLocalRepo(localPath: string): {
	clonePath: string;
	commitSha: string | null;
} {
	if (!existsSync(localPath)) {
		throw new Error(`Local path does not exist: ${localPath}`);
	}

	let commitSha: string | null = null;
	const gitDir = join(localPath, ".git");
	if (existsSync(gitDir)) {
		try {
			commitSha = execSync("git rev-parse HEAD", {
				cwd: localPath,
				encoding: "utf-8",
				timeout: 10_000,
			}).trim();
		} catch {
			// Not a valid git repo or git not available
			commitSha = null;
		}
	}

	return { clonePath: localPath, commitSha };
}

export function cloneRepo(owner: string, name: string): { clonePath: string; commitSha: string } {
	const reposDir = join(config.dataDir, "repos");
	mkdirSync(reposDir, { recursive: true });

	const clonePath = join(reposDir, `${owner}_${name}`);

	if (existsSync(clonePath)) {
		// Unshallow if needed so git diff/log works across commits
		try {
			try {
				execFileSync("git", ["fetch", "--unshallow"], {
					cwd: clonePath,
					timeout: 120_000,
					stdio: "pipe",
				});
			} catch {
				// Not a shallow clone, ignore
			}
			execFileSync("git", ["pull", "--ff-only"], {
				cwd: clonePath,
				timeout: 120_000,
				stdio: "pipe",
			});
		} catch {
			// If pull fails, remove and re-clone
			rmSync(clonePath, { recursive: true, force: true });
		}
	}

	if (!existsSync(clonePath)) {
		try {
			const ghToken = process.env.GH_TOKEN;
			const repoUrl = ghToken
				? `https://x-access-token:${ghToken}@github.com/${owner}/${name}.git`
				: `https://github.com/${owner}/${name}.git`;
			execFileSync("git", ["clone", repoUrl, clonePath], {
				timeout: 300_000,
				stdio: "pipe",
			});
		} catch (err) {
			const stderr =
				err instanceof Error && "stderr" in err
					? Buffer.isBuffer((err as any).stderr)
						? (err as any).stderr.toString()
						: String((err as any).stderr)
					: "";
			// No token configured — user needs to set one up
			if (stderr.includes("could not read Username")) {
				throw new Error(
					`This repository requires authentication. Set a GitHub token to access private repositories.`,
				);
			}
			// Token is invalid or expired
			if (stderr.includes("Authentication failed")) {
				throw new Error(
					`GitHub authentication failed. Your token may be expired or invalid — generate a new one and update your configuration.`,
				);
			}
			// Token doesn't have access, or repo doesn't exist
			if (stderr.includes("Repository not found")) {
				throw new Error(
					`Could not access ${owner}/${name}. Check that the repo URL is correct and your GitHub token has access to this repository.`,
				);
			}
			// Sanitize token from error messages before rethrowing
			const sanitized = new Error(`Failed to clone ${owner}/${name}. Check that the repository exists and is accessible.`);
			sanitized.stack = err instanceof Error ? err.stack?.replace(/x-access-token:[^@]+@/g, "x-access-token:***@") : undefined;
			throw sanitized;
		}
	}

	const commitSha = execSync("git rev-parse HEAD", {
		cwd: clonePath,
		encoding: "utf-8",
		timeout: 10_000,
	}).trim();

	return { clonePath, commitSha };
}

export function getDefaultBranch(clonePath: string): string {
	try {
		const branch = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
			cwd: clonePath,
			encoding: "utf-8",
			timeout: 10_000,
		}).trim();
		return branch.replace("refs/remotes/origin/", "");
	} catch {
		return "main";
	}
}

export const GIT_SHA_RE = /^[0-9a-f]{40}$/i;

export function getDiffSinceCommit(
	clonePath: string,
	fromSha: string,
): {
	files: { path: string }[];
	diff: string;
	commitCount: number;
	commitLog: string;
} {
	if (!GIT_SHA_RE.test(fromSha)) {
		throw new Error(`Invalid git SHA: ${fromSha}`);
	}

	const namesRaw = execFileSync("git", ["diff", `${fromSha}..HEAD`, "--name-only"], {
		cwd: clonePath,
		encoding: "utf-8",
		timeout: 30_000,
	}).trim();

	const files = namesRaw ? namesRaw.split("\n").map((path) => ({ path: path.trim() })) : [];

	const diff = execFileSync("git", ["diff", `${fromSha}..HEAD`], {
		cwd: clonePath,
		encoding: "utf-8",
		timeout: 30_000,
		maxBuffer: 10 * 1024 * 1024,
	});

	const countRaw = execFileSync("git", ["rev-list", "--count", `${fromSha}..HEAD`], {
		cwd: clonePath,
		encoding: "utf-8",
		timeout: 10_000,
	}).trim();

	const commitCount = parseInt(countRaw, 10) || 0;

	// Grab one-line commit messages so the sync prompt includes human-authored intent
	const commitLog = execFileSync(
		"git",
		["log", "--oneline", "--no-merges", "-n", "20", `${fromSha}..HEAD`],
		{
			cwd: clonePath,
			encoding: "utf-8",
			maxBuffer: 1024 * 1024,
			timeout: 10_000,
		},
	).trim();

	return { files, diff, commitCount, commitLog };
}
