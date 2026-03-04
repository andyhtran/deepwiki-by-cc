import { describe, expect, test } from "bun:test";
import { extractMermaidDiagrams } from "$lib/server/ai/generator.js";

describe("extractMermaidDiagrams", () => {
	test("extracts a flowchart diagram", () => {
		const content = [
			"Some text before",
			"```mermaid",
			"flowchart TD",
			"  A --> B",
			"  B --> C",
			"```",
			"Some text after",
		].join("\n");

		const diagrams = extractMermaidDiagrams(content);
		expect(diagrams).toHaveLength(1);
		expect(diagrams[0]).toContain("flowchart TD");
		expect(diagrams[0]).toContain("A --> B");
	});

	test("extracts multiple diagrams", () => {
		const content = [
			"```mermaid",
			"graph LR",
			"  A --> B",
			"```",
			"",
			"```mermaid",
			"sequenceDiagram",
			"  Alice->>Bob: Hello",
			"```",
		].join("\n");

		const diagrams = extractMermaidDiagrams(content);
		expect(diagrams).toHaveLength(2);
	});

	test("rejects invalid diagram types", () => {
		const content = ["```mermaid", "notADiagramType", "  A --> B", "```"].join("\n");

		const diagrams = extractMermaidDiagrams(content);
		expect(diagrams).toHaveLength(0);
	});

	test("returns empty array when no diagrams exist", () => {
		const content = "Just regular markdown with no diagrams.";
		expect(extractMermaidDiagrams(content)).toEqual([]);
	});

	test("handles all valid diagram types", () => {
		const types = [
			"graph TD",
			"flowchart LR",
			"sequenceDiagram",
			"classDiagram",
			"stateDiagram",
			"erDiagram",
			"gantt",
			"pie",
			"gitgraph",
			"mindmap",
		];

		for (const type of types) {
			const content = `\`\`\`mermaid\n${type}\n  content\n\`\`\``;
			const diagrams = extractMermaidDiagrams(content);
			expect(diagrams).toHaveLength(1);
		}
	});

	test("ignores non-mermaid code blocks", () => {
		const content = [
			"```typescript",
			"const x = 1;",
			"```",
			"```mermaid",
			"graph TD",
			"  A --> B",
			"```",
		].join("\n");

		const diagrams = extractMermaidDiagrams(content);
		expect(diagrams).toHaveLength(1);
		expect(diagrams[0]).toContain("graph TD");
	});
});
