import { beforeEach, describe, expect, mock, test } from "bun:test";

const setSetting = mock((_key: string, _value: string) => {});

mock.module("$lib/server/db/settings.js", () => ({
	setSetting,
}));

import { PUT } from "../src/routes/api/settings/+server.js";

async function sendSettings(payload: Record<string, unknown>): Promise<void> {
	const request = new Request("http://localhost/api/settings", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});

	const response = await PUT({ request } as never);
	expect(response.status).toBe(200);
}

describe("settings API model validation", () => {
	beforeEach(() => {
		setSetting.mockClear();
	});

	test("accepts all valid generation model ids", async () => {
		await sendSettings({ generationModel: "claude-sonnet-4-6" });
		await sendSettings({ generationModel: "claude-opus-4-6" });
		await sendSettings({ generationModel: "codex-gpt-5-3-xhigh" });

		expect(setSetting.mock.calls).toEqual([
			["generationModel", "claude-sonnet-4-6"],
			["generationModel", "claude-opus-4-6"],
			["generationModel", "codex-gpt-5-3-xhigh"],
		]);
	});

	test("ignores invalid generation model ids", async () => {
		await sendSettings({ generationModel: "not-a-model" });
		expect(setSetting).not.toHaveBeenCalled();
	});
});
