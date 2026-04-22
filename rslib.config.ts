import { defineConfig } from "@rslib/core";

/**
 * Bundleless build for `@anvilkit/plugin-version-history`.
 *
 * Each `.ts` under `src/` becomes an individual ESM + CJS output in
 * `dist/`, mirroring the other Studio plugins. Workspace runtime
 * packages and host peers stay external so this package ships as a
 * thin headless adapter layer.
 */
export default defineConfig({
	source: {
		entry: {
			index: [
				"./src/**/*.ts",
				"./src/**/*.tsx",
				"!./src/**/*.test.ts",
				"!./src/**/*.test.tsx",
				"!./src/**/*.spec.ts",
				"!./src/**/*.spec.tsx",
				"!./src/**/__tests__/**",
			],
		},
	},
	lib: [
		{
			bundle: false,
			dts: {
				autoExtension: true,
			},
			format: "esm",
		},
		{
			bundle: false,
			dts: {
				autoExtension: true,
			},
			format: "cjs",
		},
	],
	output: {
		target: "node",
		externals: [
			"@anvilkit/core",
			"@anvilkit/ir",
			"@anvilkit/ui",
			"@anvilkit/utils",
			"@puckeditor/core",
			"react",
			"react-dom",
		],
	},
});
