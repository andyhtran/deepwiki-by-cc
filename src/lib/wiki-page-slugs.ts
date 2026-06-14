export interface WikiPageSlugPage {
	id: string;
	title: string;
}

export interface WikiPageSlugSection {
	pages?: WikiPageSlugPage[];
}

export interface WikiPageSlugStructure {
	sections?: WikiPageSlugSection[];
}

export interface WikiPageSlugEntry {
	pageId: string;
	title: string;
	slug: string;
}

export function slugifyWikiPageTitle(value: string): string {
	const slug = value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(/['']/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-");

	return slug || "page";
}

export function buildWikiPageSlugEntries(structure: WikiPageSlugStructure): WikiPageSlugEntry[] {
	const entries: WikiPageSlugEntry[] = [];

	for (const [sectionIndex, section] of (structure.sections ?? []).entries()) {
		for (const [pageIndex, page] of (section.pages ?? []).entries()) {
			entries.push({
				pageId: page.id,
				title: page.title,
				slug: `${sectionIndex + 1}.${pageIndex + 1}-${slugifyWikiPageTitle(page.title || page.id)}`,
			});
		}
	}

	return entries;
}

export function getWikiPageSlug(structure: WikiPageSlugStructure, pageId: string): string | null {
	return buildWikiPageSlugEntries(structure).find((entry) => entry.pageId === pageId)?.slug ?? null;
}

export function resolveWikiPageSlug(
	structure: WikiPageSlugStructure,
	candidate: string,
): WikiPageSlugEntry | null {
	const normalized = decodeURIComponent(candidate).trim().toLowerCase();
	const entries = buildWikiPageSlugEntries(structure);

	return (
		entries.find((entry) => entry.slug === normalized) ??
		entries.find((entry) => slugifyWikiPageTitle(entry.pageId) === normalized) ??
		null
	);
}

export function buildWikiPagePath({
	owner,
	repo,
	pageSlug,
	version,
}: {
	owner: string;
	repo: string;
	pageSlug?: string | null;
	version?: string | number | null;
}): string {
	const path = `/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${
		pageSlug ? `/${encodeURIComponent(pageSlug)}` : ""
	}`;

	return version ? `${path}?v=${encodeURIComponent(String(version))}` : path;
}
