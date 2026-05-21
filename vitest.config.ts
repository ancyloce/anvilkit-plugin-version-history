import { nodePreset } from "@anvilkit/vitest-config/node";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
	nodePreset,
	defineConfig({
		test: {
			coverage: {
				enabled: true,
				provider: "v8",
				include: ["src/diff.ts"],
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
		},
	}),
);
