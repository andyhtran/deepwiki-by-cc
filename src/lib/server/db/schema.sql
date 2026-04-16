PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS repos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    full_name TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    default_branch TEXT DEFAULT 'main',
    last_commit_sha TEXT,
    clone_path TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    language TEXT,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(repo_id, file_path)
);

CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS document_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    chunk_seq INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    offset_start INTEGER NOT NULL,
    offset_end INTEGER NOT NULL,
    token_count INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(repo_id, file_path, content_hash, chunk_seq)
);

CREATE TABLE IF NOT EXISTS chunk_embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_id INTEGER NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    embedding TEXT NOT NULL,
    embedding_dim INTEGER NOT NULL,
    embedding_model TEXT NOT NULL,
    endpoint_fingerprint TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(chunk_id, embedding_model, endpoint_fingerprint)
);

CREATE TABLE IF NOT EXISTS wikis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER REFERENCES repos(id) ON DELETE CASCADE,
    version INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    structure TEXT NOT NULL,
    model TEXT NOT NULL,
    source_type TEXT DEFAULT 'github',
    generation_duration_ms INTEGER,
    embedding_enabled INTEGER NOT NULL DEFAULT 0,
    embedding_model TEXT,
    embedding_endpoint_fingerprint TEXT,
    status TEXT DEFAULT 'generating',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wiki_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wiki_id INTEGER NOT NULL REFERENCES wikis(id) ON DELETE CASCADE,
    page_id TEXT NOT NULL,
    title TEXT NOT NULL,
    parent_id TEXT,
    sort_order INTEGER DEFAULT 0,
    content TEXT,
    diagrams TEXT,
    file_paths TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    model TEXT,
    generation_time_ms INTEGER,
    status TEXT DEFAULT 'pending',
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(wiki_id, page_id)
);

CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    repo_id INTEGER REFERENCES repos(id) ON DELETE CASCADE,
    wiki_id INTEGER REFERENCES wikis(id) ON DELETE SET NULL,
    params TEXT,
    status TEXT DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    progress_message TEXT,
    total_prompt_tokens INTEGER,
    total_completion_tokens INTEGER,
    total_cost REAL,
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wikis_repo ON wikis(repo_id);
CREATE INDEX IF NOT EXISTS idx_documents_repo ON documents(repo_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_repo_path ON document_chunks(repo_id, file_path);
CREATE INDEX IF NOT EXISTS idx_document_chunks_repo_hash ON document_chunks(repo_id, file_path, content_hash);
CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_repo_model_endpoint ON chunk_embeddings(repo_id, embedding_model, endpoint_fingerprint);
CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_repo_path ON chunk_embeddings(repo_id, file_path);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_wiki ON wiki_pages(wiki_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_repo ON jobs(repo_id);
