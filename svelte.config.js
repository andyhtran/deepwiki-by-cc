import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	onwarn(warning, handler) {
		if (warning.code === "state_referenced_locally") return;
		handler(warning);
	},
	kit: {
		adapter: adapter({
			out: "build",
			precompress: true,
		}),
	},
};

export default config;
