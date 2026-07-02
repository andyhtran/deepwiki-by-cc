import { describe, expect, test } from "bun:test";
import { formatRelativeTime, parseAppTimestamp } from "$lib/datetime.js";

describe("app timestamp formatting", () => {
	test("treats SQLite timestamps as UTC", () => {
		expect(parseAppTimestamp("2026-06-14 06:00:01")).toBe(Date.parse("2026-06-14T06:00:01Z"));
	});

	test("preserves explicit ISO timezones", () => {
		expect(parseAppTimestamp("2026-06-14T06:00:01-07:00")).toBe(
			Date.parse("2026-06-14T06:00:01-07:00"),
		);
	});

	test("formats relative time from UTC-normalized timestamps", () => {
		const now = Date.parse("2026-06-14T10:04:00Z");
		expect(formatRelativeTime("2026-06-14 06:00:01", now)).toBe("4h ago");
	});
});
