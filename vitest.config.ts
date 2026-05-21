import { nodePreset } from "@anvilkit/vitest-config/node";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
	nodePreset,
	defineConfig({
		test: {
			coverage: {
				enabled: true,
				provider: "v8",
				include: ["src/utils/diff.ts"],
				reporter: ["text"],
				thresholds: {
					lines: 95,
				},
			},
			include: [
				"src/**/*.{test,spec}.ts",
				"src/**/*.{test,spec}.tsx",
				"src/**/__tests__/**/*.{test,spec}.ts",
				"src/**/__tests__/**/*.{test,spec}.tsx",
			],
			name: "@anvilkit/plugin-version-history",
			passWithNoTests: true,
			// The jsdom UI tests (`src/ui/__tests__/*.tsx`, opted in via a
			// per-file `@vitest-environment jsdom` docblock) render React +
			// run axe. In isolation they finish in ~1–4s, but under `pnpm
			// test`'s Turbo fan-out — every workspace package's Vitest
			// cold-running at once — the jsdom environment is heavily
			// CPU-contended and they blow the default 5s `testTimeout`.
			// Raise the ceiling so contention-induced slowness doesn't flake
			// CI; a genuine hang still fails, just later.
			testTimeout: 30000,
			hookTimeout: 30000,
		},
	}),
);
