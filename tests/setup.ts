import { mock } from "bun:test";

// Stub SvelteKit runtime modules that aren't available in tests
mock.module("$env/dynamic/private", () => ({
	env: {},
}));
