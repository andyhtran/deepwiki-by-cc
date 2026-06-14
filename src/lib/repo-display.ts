export function formatRepoDisplayName(input: {
	owner: string | null | undefined;
	repoName: string | null | undefined;
	showOwner?: boolean;
}): string {
	const repoName = input.repoName?.trim() || "unknown";
	if (input.showOwner === false) return repoName;
	return `${input.owner?.trim() || "unknown"}/${repoName}`;
}

export function formatRepoDisplayNameFromFullName(
	fullName: string | null | undefined,
	showOwner = true,
): string {
	const name = fullName?.trim() || "unknown";
	if (showOwner) return name;

	const slash = name.lastIndexOf("/");
	if (slash < 0 || slash === name.length - 1) return name;
	return name.slice(slash + 1);
}
