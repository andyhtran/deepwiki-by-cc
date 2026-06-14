const EXPLICIT_TIMEZONE_RE = /T.*(Z|[+-]\d{2}:?\d{2})$/;

export function parseAppTimestamp(dateStr: string): number {
	const trimmed = dateStr.trim();
	if (!trimmed) return Number.NaN;

	if (EXPLICIT_TIMEZONE_RE.test(trimmed)) {
		return new Date(trimmed).getTime();
	}

	// SQLite datetime('now') stores UTC as "YYYY-MM-DD HH:MM:SS" without a zone.
	// Browsers parse that shape as local time, so timezone-less app timestamps
	// must be normalized before relative-time or date-only display.
	const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
	return new Date(`${normalized}Z`).getTime();
}

export function formatAppDate(dateStr: string): string {
	const ts = parseAppTimestamp(dateStr);
	if (!Number.isFinite(ts)) return "";
	return new Date(ts).toLocaleDateString();
}

export function formatRelativeTime(dateStr: string, now = Date.now()): string {
	const then = parseAppTimestamp(dateStr);
	if (!Number.isFinite(then)) return "";

	const diffMs = now - then;
	if (diffMs < 60_000) return "just now";

	const minutes = Math.floor(diffMs / 60_000);
	if (minutes < 60) return `${minutes}m ago`;

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;

	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}
