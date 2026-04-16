import pino from "pino";

const dev = process.env.NODE_ENV !== "production";

const logger = pino({
	level: process.env.LOG_LEVEL || (dev ? "debug" : "info"),
	...(dev && { transport: { target: "pino-pretty" } }),
});

export const log = {
	startup: logger.child({ component: "startup" }),
	worker: logger.child({ component: "worker" }),
	generation: logger.child({ component: "generation" }),
	generator: logger.child({ component: "generator" }),
	embeddings: logger.child({ component: "embeddings" }),
	cli: logger.child({ component: "claude-cli" }),
	codex: logger.child({ component: "codex-cli" }),
	resume: logger.child({ component: "resume" }),
	retrieval: logger.child({ component: "retrieval" }),
};
