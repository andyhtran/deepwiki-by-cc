type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

let preference = $state<ThemePreference>("system");
let resolved = $state<ResolvedTheme>("dark");

function updateResolved() {
	if (preference === "system") {
		resolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
	} else {
		resolved = preference;
	}
	document.documentElement.setAttribute("data-theme", resolved);

	const darkLink = document.getElementById("hljs-dark") as HTMLLinkElement | null;
	const lightLink = document.getElementById("hljs-light") as HTMLLinkElement | null;
	if (darkLink) darkLink.disabled = resolved !== "dark";
	if (lightLink) lightLink.disabled = resolved !== "light";
}

function init() {
	const stored = localStorage.getItem("theme");
	if (stored === "light" || stored === "dark" || stored === "system") {
		preference = stored;
	}
	updateResolved();
	window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", updateResolved);
}

function setTheme(t: ThemePreference) {
	preference = t;
	localStorage.setItem("theme", t);
	updateResolved();
}

function cycle() {
	const order: ThemePreference[] = ["light", "dark", "system"];
	const idx = order.indexOf(preference);
	setTheme(order[(idx + 1) % order.length]);
}

export const theme = {
	get preference() {
		return preference;
	},
	init,
	cycle,
};
