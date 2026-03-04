import { getDb } from "../db/index.js";

export interface FileContent {
	filePath: string;
	language: string | null;
	content: string;
}

export function retrieveFileContents(repoId: number, filePaths: string[]): FileContent[] {
	if (filePaths.length === 0) return [];

	const db = getDb();
	const placeholders = filePaths.map(() => "?").join(",");

	const rows = db
		.prepare(
			`SELECT file_path, language, content
			 FROM documents
			 WHERE repo_id = ? AND file_path IN (${placeholders})
			 ORDER BY file_path`,
		)
		.all(repoId, ...filePaths) as { file_path: string; language: string | null; content: string }[];

	return rows.map((row) => ({
		filePath: row.file_path,
		language: row.language,
		content: row.content,
	}));
}

export function formatFilesForContext(files: FileContent[]): string {
	const parts: string[] = [];

	for (const file of files) {
		const lang = file.language || "";
		parts.push(`### ${file.filePath}`);
		parts.push(`\`\`\`${lang}`);
		parts.push(file.content);
		parts.push("```");
		parts.push("");
	}

	let result = parts.join("\n");
	if (result.length > 100_000) {
		const truncated = result.slice(0, 100_000);
		const includedFiles = new Set(
			files.filter((f) => truncated.includes(`### ${f.filePath}`)).map((f) => f.filePath),
		);
		const droppedFiles = files.filter((f) => !includedFiles.has(f.filePath)).map((f) => f.filePath);

		result = truncated;
		result += "\n\n... (context truncated)";
		if (droppedFiles.length > 0) {
			result += `\n\nFiles omitted due to context limit:\n${droppedFiles.map((f) => `- ${f}`).join("\n")}`;
		}
	}

	return result;
}
