import { describe, expect, test } from "bun:test";
import { enforceDiagramPolicy, normalizeMermaidSignature } from "$lib/server/ai/diagram-policy.js";

function mermaidBlock(body: string): string {
	return `\`\`\`mermaid\n${body}\n\`\`\``;
}

describe("enforceDiagramPolicy", () => {
	test("no mermaid blocks → content unchanged, diagrams empty", () => {
		const content = "# Title\n\nJust text, no diagrams.";
		const result = enforceDiagramPolicy(content);
		expect(result.content).toBe(content);
		expect(result.diagrams).toEqual([]);
	});

	test("single block preserved", () => {
		const block = mermaidBlock("graph TD\n  A --> B");
		const content = `Intro\n\n${block}\n\nOutro`;
		const result = enforceDiagramPolicy(content);
		expect(result.content).toBe(content);
		expect(result.diagrams.length).toBe(1);
	});

	test("two identical blocks → dedupe to one", () => {
		const block = mermaidBlock("graph TD\n  A --> B");
		const content = `One\n\n${block}\n\nTwo\n\n${block}\n\nEnd`;
		const result = enforceDiagramPolicy(content);
		const blockCount = (result.content.match(/```mermaid/g) || []).length;
		expect(blockCount).toBe(1);
		expect(result.diagrams.length).toBe(1);
		expect(result.content).toContain("One");
		expect(result.content).toContain("Two");
		expect(result.content).toContain("End");
	});

	test("near-identical blocks differing only in whitespace/quoting dedupe", () => {
		const a = mermaidBlock('graph TD\n  A["Node"] --> B["Other"]');
		const b = mermaidBlock('graph  TD\n  A[ "node" ]   -->   B[ "Other" ]');
		const content = `${a}\n\nMid\n\n${b}`;
		const result = enforceDiagramPolicy(content);
		const blockCount = (result.content.match(/```mermaid/g) || []).length;
		expect(blockCount).toBe(1);
	});

	test("three distinct valid blocks → keep first 2", () => {
		const b1 = mermaidBlock("graph TD\n  A --> B");
		const b2 = mermaidBlock("sequenceDiagram\n  Alice->>Bob: Hi");
		const b3 = mermaidBlock("classDiagram\n  class Foo");
		const content = `${b1}\n\n${b2}\n\n${b3}`;
		const result = enforceDiagramPolicy(content);
		const blockCount = (result.content.match(/```mermaid/g) || []).length;
		expect(blockCount).toBe(2);
		expect(result.content).toContain("graph TD");
		expect(result.content).toContain("sequenceDiagram");
		expect(result.content).not.toContain("classDiagram");
		expect(result.diagrams.length).toBe(2);
	});

	test("maxDiagrams override parameter works", () => {
		const b1 = mermaidBlock("graph TD\n  A --> B");
		const b2 = mermaidBlock("sequenceDiagram\n  Alice->>Bob: Hi");
		const content = `${b1}\n\n${b2}`;
		const result = enforceDiagramPolicy(content, 1);
		const blockCount = (result.content.match(/```mermaid/g) || []).length;
		expect(blockCount).toBe(1);
		expect(result.diagrams.length).toBe(1);
	});

	test("block removal preserves surrounding markdown", () => {
		const b1 = mermaidBlock("graph TD\n  A --> B");
		const b2 = mermaidBlock("graph TD\n  A --> B");
		const content = `## Section\n\nSome intro text.\n\n${b1}\n\nAnalysis paragraph.\n\n${b2}\n\n## Next Section`;
		const result = enforceDiagramPolicy(content);
		expect(result.content).toContain("## Section");
		expect(result.content).toContain("Some intro text.");
		expect(result.content).toContain("Analysis paragraph.");
		expect(result.content).toContain("## Next Section");
	});

	test("invalid mermaid block types are excluded from diagrams but stay in content", () => {
		const valid = mermaidBlock("graph TD\n  A --> B");
		const invalid = mermaidBlock("notAMermaidType\n  A --> B");
		const content = `${valid}\n\n${invalid}`;
		const result = enforceDiagramPolicy(content);
		expect(result.content).toContain("notAMermaidType");
		expect(result.diagrams.length).toBe(1);
		expect(result.diagrams[0]).toContain("graph TD");
	});
});

describe("normalizeMermaidSignature", () => {
	test("collapses whitespace", () => {
		const a = normalizeMermaidSignature("graph TD\n  A --> B");
		const b = normalizeMermaidSignature("graph  TD\n    A   -->  B");
		expect(a).toBe(b);
	});

	test("strips quotes from simple alphanumeric labels", () => {
		const a = normalizeMermaidSignature('graph TD\n  A["Node"] --> B');
		const b = normalizeMermaidSignature("graph TD\n  A[node] --> B");
		expect(a).toBe(b);
	});

	test("distinct diagrams produce distinct signatures", () => {
		const a = normalizeMermaidSignature("graph TD\n  A --> B");
		const b = normalizeMermaidSignature("graph TD\n  A --> C");
		expect(a).not.toBe(b);
	});
});
