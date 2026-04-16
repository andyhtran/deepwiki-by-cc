import { describe, expect, test } from "bun:test";
import type { WeaknessThresholds } from "$lib/server/config.js";
import {
	computeRetrievalMetadata,
	isRetrievalWeak,
	type RetrievalMetadata,
	type RetrievedChunk,
} from "$lib/server/embeddings/retrieval.js";

const defaultThresholds: WeaknessThresholds = {
	minChunks: 3,
	minContextChars: 4000,
	minTopScore: 0.3,
	minScoreGap: 0.05,
};

function makeChunk(filePath: string, score: number, textLen: number = 500): RetrievedChunk {
	return {
		filePath,
		chunkSeq: 0,
		chunkText: "x".repeat(textLen),
		offsetStart: 0,
		offsetEnd: textLen,
		score,
	};
}

describe("computeRetrievalMetadata", () => {
	test("returns zeros for empty chunks", () => {
		const meta = computeRetrievalMetadata([]);
		expect(meta.chunkCount).toBe(0);
		expect(meta.contextChars).toBe(0);
		expect(meta.topScore).toBe(0);
		expect(meta.meanScore).toBe(0);
		expect(meta.scoreGap).toBe(0);
		expect(meta.uniqueFiles).toBe(0);
	});

	test("computes correct metadata for multiple chunks", () => {
		const chunks = [
			makeChunk("a.ts", 0.9, 2000),
			makeChunk("b.ts", 0.7, 1500),
			makeChunk("a.ts", 0.5, 1000),
		];
		const meta = computeRetrievalMetadata(chunks);
		expect(meta.chunkCount).toBe(3);
		expect(meta.contextChars).toBe(4500);
		expect(meta.topScore).toBe(0.9);
		expect(meta.meanScore).toBeCloseTo(0.7, 4);
		expect(meta.scoreGap).toBeCloseTo(0.2, 4);
		expect(meta.uniqueFiles).toBe(2);
	});

	test("scoreGap equals topScore when only one chunk", () => {
		const chunks = [makeChunk("a.ts", 0.8)];
		const meta = computeRetrievalMetadata(chunks);
		expect(meta.scoreGap).toBe(0.8);
	});
});

describe("isRetrievalWeak", () => {
	test("strong retrieval returns not weak", () => {
		const meta: RetrievalMetadata = {
			chunkCount: 5,
			contextChars: 10000,
			topScore: 0.85,
			meanScore: 0.6,
			scoreGap: 0.15,
			uniqueFiles: 3,
		};
		const { weak, reasons } = isRetrievalWeak(meta, defaultThresholds);
		expect(weak).toBe(false);
		expect(reasons).toEqual([]);
	});

	test("too few chunks triggers weakness", () => {
		const meta: RetrievalMetadata = {
			chunkCount: 2,
			contextChars: 10000,
			topScore: 0.85,
			meanScore: 0.6,
			scoreGap: 0.15,
			uniqueFiles: 2,
		};
		const { weak, reasons } = isRetrievalWeak(meta, defaultThresholds);
		expect(weak).toBe(true);
		expect(reasons.length).toBe(1);
		expect(reasons[0]).toContain("chunkCount");
	});

	test("low context chars triggers weakness", () => {
		const meta: RetrievalMetadata = {
			chunkCount: 5,
			contextChars: 2000,
			topScore: 0.85,
			meanScore: 0.6,
			scoreGap: 0.15,
			uniqueFiles: 3,
		};
		const { weak, reasons } = isRetrievalWeak(meta, defaultThresholds);
		expect(weak).toBe(true);
		expect(reasons.some((r) => r.includes("contextChars"))).toBe(true);
	});

	test("low top score triggers weakness", () => {
		const meta: RetrievalMetadata = {
			chunkCount: 5,
			contextChars: 10000,
			topScore: 0.2,
			meanScore: 0.15,
			scoreGap: 0.1,
			uniqueFiles: 3,
		};
		const { weak, reasons } = isRetrievalWeak(meta, defaultThresholds);
		expect(weak).toBe(true);
		expect(reasons.some((r) => r.includes("topScore"))).toBe(true);
	});

	test("flat score gap triggers weakness", () => {
		const meta: RetrievalMetadata = {
			chunkCount: 5,
			contextChars: 10000,
			topScore: 0.5,
			meanScore: 0.49,
			scoreGap: 0.01,
			uniqueFiles: 3,
		};
		const { weak, reasons } = isRetrievalWeak(meta, defaultThresholds);
		expect(weak).toBe(true);
		expect(reasons.some((r) => r.includes("scoreGap"))).toBe(true);
	});

	test("multiple weakness reasons can accumulate", () => {
		const meta: RetrievalMetadata = {
			chunkCount: 1,
			contextChars: 500,
			topScore: 0.1,
			meanScore: 0.1,
			scoreGap: 0.0,
			uniqueFiles: 1,
		};
		const { weak, reasons } = isRetrievalWeak(meta, defaultThresholds);
		expect(weak).toBe(true);
		expect(reasons.length).toBe(4);
	});
});
