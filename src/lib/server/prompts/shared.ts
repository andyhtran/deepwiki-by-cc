export const MERMAID_SYNTAX_RULES = `CRITICAL mermaid syntax rules — violating these causes render failures:
- ALWAYS quote node labels with square brackets: use \`A["Label"]\` not \`A[Label]\`
- Labels with parentheses, colons, commas, or special chars MUST be quoted: \`A["Type: Value (optional)"]\`
- Use simple alphanumeric node IDs: \`node1\`, \`audioCapture\`, \`stateA\` — no spaces or special chars in IDs
- Do NOT use \`%%\` comments, \`style\`, or \`classDef\` directives
- For sequenceDiagram: use \`participant A as "Display Name"\` when names have special chars
- For classDiagram: use simple class names, put details in methods/attributes
- Use \`-->\` for arrows in flowchart/graph, \`->>\` for sequence diagrams (exactly two \`>\`, not three)
- Do NOT put line breaks inside node labels`;
