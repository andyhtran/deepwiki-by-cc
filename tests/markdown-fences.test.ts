import { describe, expect, test } from "bun:test";
import { findTopLevelMermaidFences, splitOnMermaidFences } from "../src/lib/markdown-fences.js";

describe("splitOnMermaidFences", () => {
	test("splits text and diagrams in authored order", () => {
		const md = [
			"Intro paragraph.",
			"",
			"```mermaid",
			"graph TD",
			"    A --> B",
			"```",
			"",
			"Outro paragraph.",
		].join("\n");
		const chunks = splitOnMermaidFences(md);
		expect(chunks.map((c) => c.type)).toEqual(["text", "mermaid", "text"]);
		expect(chunks[1]).toEqual({ type: "mermaid", code: "graph TD\n    A --> B" });
		expect((chunks[0] as { value: string }).value).toContain("Intro paragraph.");
		expect((chunks[2] as { value: string }).value).toContain("Outro paragraph.");
	});

	test("returns a single text chunk when no diagrams exist", () => {
		const chunks = splitOnMermaidFences("Just prose, no diagrams.");
		expect(chunks).toEqual([{ type: "text", value: "Just prose, no diagrams." }]);
	});

	test("does not split on a mermaid fence quoted inside a wrapping code block", () => {
		// A page documenting mermaid usage: the example fence must stay inside
		// the quoted block instead of being rendered as a real diagram.
		const md = [
			"Diagram fences look like this:",
			"",
			"````md",
			"```mermaid",
			"graph TD",
			"    Quoted --> Example",
			"```",
			"````",
			"",
			"And a real diagram follows:",
			"",
			"```mermaid",
			"sequenceDiagram",
			"    A->>B: hi",
			"```",
		].join("\n");
		const chunks = splitOnMermaidFences(md);
		const mermaidChunks = chunks.filter((c) => c.type === "mermaid");
		expect(mermaidChunks).toHaveLength(1);
		expect((mermaidChunks[0] as { code: string }).code).toContain("sequenceDiagram");
		const textJoined = chunks
			.filter((c) => c.type === "text")
			.map((c) => (c as { value: string }).value)
			.join("");
		expect(textJoined).toContain("Quoted --> Example");
		expect(textJoined).toContain("````md");
	});

	test("ignores mermaid mentions in inline code and quoted regexes", () => {
		const md =
			"The viewer splits on ` ```mermaid ` fences.\n\n" +
			"```ts\nconst re = /```mermaid\\n([\\s\\S]*?)```/g;\n```";
		const chunks = splitOnMermaidFences(md);
		expect(chunks).toHaveLength(1);
		expect(chunks[0].type).toBe("text");
	});
});

describe("findTopLevelMermaidFences", () => {
	test("reports offsets that reconstruct the original content", () => {
		const md = "before\n\n```mermaid\ngraph TD\n    A --> B\n```\nafter";
		const [block] = findTopLevelMermaidFences(md);
		expect(md.slice(block.start, block.end)).toBe("```mermaid\ngraph TD\n    A --> B\n```");
	});

	test("requires closing fences of at least the opening length", () => {
		const md = "````mermaid\ngraph TD\n```\nstill inside\n````";
		const [block] = findTopLevelMermaidFences(md);
		expect(block.code).toContain("still inside");
		expect(block.code).toContain("```");
	});
});
