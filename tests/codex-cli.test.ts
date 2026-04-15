import { describe, expect, test } from "bun:test";
import {
	parseSchemaOutputFromMessages,
	selectFinalAgentMessage,
} from "$lib/server/ai/codex-cli.js";

describe("selectFinalAgentMessage", () => {
	test("returns the last non-empty agent message", () => {
		const messages = ["first", "   ", "", "final payload"];
		expect(selectFinalAgentMessage(messages)).toBe("final payload");
	});

	test("returns empty string when there are no messages", () => {
		expect(selectFinalAgentMessage([])).toBe("");
	});
});

describe("parseSchemaOutputFromMessages", () => {
	test("uses the last valid JSON message when multiple are present", () => {
		const messages = [
			'{"content":"I am drafting this page"}',
			'{"content":"## Final page content"}',
		];

		expect(parseSchemaOutputFromMessages(messages)).toEqual({
			content: "## Final page content",
		});
	});

	test("parses JSON wrapped in markdown fences", () => {
		const messages = ['```json\n{"content":"hello"}\n```'];
		expect(parseSchemaOutputFromMessages(messages)).toEqual({ content: "hello" });
	});

	test("throws when the final message is invalid JSON", () => {
		const messages = ['{"content":"usable payload"}', "{not json"];
		expect(() => parseSchemaOutputFromMessages(messages)).toThrow();
	});

	test("throws if no valid JSON exists in any message", () => {
		expect(() => parseSchemaOutputFromMessages(["not json", "still not json"])).toThrow();
	});
});
