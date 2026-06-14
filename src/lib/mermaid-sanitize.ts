const QUOTED_SHAPE_LABEL_RE = /(^|[^\w"])([A-Za-z][\w-]*)([[{(])\s*"([^"\n]*)"\s*([\]})])/g;

function matchingShapeDelimiter(open: string, close: string): boolean {
	return (
		(open === "[" && close === "]") ||
		(open === "{" && close === "}") ||
		(open === "(" && close === ")")
	);
}

export function sanitizeMermaid(src: string): string {
	const normalized = src
		.replace(/->>>+/g, "->>")
		.replace(
			QUOTED_SHAPE_LABEL_RE,
			(match, prefix: string, id: string, open: string, label: string, close: string) => {
				if (!matchingShapeDelimiter(open, close)) return match;
				return `${prefix}${id}${open}"${label}"${close}`;
			},
		);

	return normalized.replace(/(\w+)\[([^\]"]+)\]/g, (_match, id: string, label: string) => {
		if (/[():,;{}|<>]/.test(label)) {
			return `${id}["${label.replace(/"/g, "#quot;")}"]`;
		}
		return _match;
	});
}
