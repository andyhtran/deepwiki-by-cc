// Two-row-DP Levenshtein. Cheap enough for small candidate lists.
export function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;
	let prev = new Array(b.length + 1);
	let curr = new Array(b.length + 1);
	for (let j = 0; j <= b.length; j++) prev[j] = j;
	for (let i = 1; i <= a.length; i++) {
		curr[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
		}
		[prev, curr] = [curr, prev];
	}
	return prev[b.length];
}

// Rank candidates by closeness to `query`. Substring matches first, then
// small edit distances. Case-insensitive throughout. Returns at most `limit`.
//
// The distance threshold scales with the longer of the two strings so that
// long identifiers (e.g. hyphenated page IDs ~40 chars) tolerate proportional
// edits. Ranking between non-substring matches uses ratio so a 2-edit miss on
// a 10-char id beats a 10-edit miss on a 40-char id.
export function didYouMean(query: string, candidates: string[], limit = 3): string[] {
	const q = query.trim().toLowerCase();
	if (q.length === 0 || candidates.length === 0) return [];
	const scored: { cand: string; substring: boolean; ratio: number; distance: number }[] = [];
	for (const cand of candidates) {
		const c = cand.toLowerCase();
		const substring = c.includes(q) || q.includes(c);
		const distance = levenshtein(q, c);
		const maxLen = Math.max(q.length, c.length);
		const ratio = maxLen > 0 ? distance / maxLen : 1;
		// Allow up to ~50% edits for long strings; floor at 3 so tiny queries
		// still get some tolerance.
		const maxDistance = Math.max(3, Math.floor(maxLen * 0.5));
		if (substring || distance <= maxDistance) {
			scored.push({ cand, substring, ratio, distance });
		}
	}
	scored.sort((a, b) => {
		if (a.substring !== b.substring) return a.substring ? -1 : 1;
		return a.ratio - b.ratio;
	});
	return scored.slice(0, limit).map((s) => s.cand);
}
