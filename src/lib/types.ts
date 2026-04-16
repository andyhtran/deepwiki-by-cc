export interface Repo {
	id: number;
	owner: string;
	name: string;
	full_name: string;
	url: string;
	default_branch: string;
	last_commit_sha: string | null;
	clone_path: string | null;
	created_at: string;
	updated_at: string;
}

export interface Wiki {
	id: number;
	repo_id: number | null;
	version: number;
	title: string;
	description: string | null;
	structure: string;
	model: string;
	source_type: "github" | "local";
	generation_duration_ms: number | null;
	embedding_enabled: number;
	embedding_model: string | null;
	embedding_endpoint_fingerprint: string | null;
	status: "generating" | "completed" | "failed";
	created_at: string;
	updated_at: string;
}

/** Compact snapshot of embedding config at job creation time */
export interface EmbeddingSnapshot {
	enabled: boolean;
	model: string | null;
	endpointFingerprint: string | null;
}

export interface WikiPage {
	id: number;
	wiki_id: number;
	page_id: string;
	title: string;
	parent_id: string | null;
	sort_order: number;
	content: string | null;
	diagrams: string | null;
	file_paths: string | null;
	status: "pending" | "generating" | "completed" | "failed";
	error_message: string | null;
	prompt_tokens: number | null;
	completion_tokens: number | null;
	model: string | null;
	generation_time_ms: number | null;
	created_at: string;
	updated_at: string;
}

export interface Job {
	id: number;
	type: "full-generation" | "sync" | "resume-generation";
	repo_id: number | null;
	wiki_id: number | null;
	params: string | null;
	status: "pending" | "processing" | "completed" | "failed" | "cancelled";
	progress: number;
	progress_message: string | null;
	error_message: string | null;
	total_prompt_tokens: number | null;
	total_completion_tokens: number | null;
	total_cost: number | null;
	started_at: string | null;
	completed_at: string | null;
	created_at: string;
}

interface WikiOutlineSection {
	id: string;
	title: string;
	description: string;
	pages: WikiOutlinePage[];
}

export interface WikiOutlinePage {
	id: string;
	title: string;
	description: string;
	filePaths: string[];
	diagrams?: string[];
}

export interface WikiOutline {
	title: string;
	description: string;
	sections: WikiOutlineSection[];
}
