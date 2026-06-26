import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";

/**
 * Public API surface guard: the `exports` map must expose ONLY the
 * documented subpaths (main, `./ui`, `./testing`). A `"./*"` wildcard
 * subpath would leak internals (`utils/state`, `adapters/snapshot-chain`,
 * …) into the public API even though the README documents only the three
 * supported entries.
 */
describe("package.json exports map", () => {
	const exportsMap = packageJson.exports as Record<string, unknown>;

	it("does not expose a wildcard `./*` subpath", () => {
		expect(Object.keys(exportsMap)).not.toContain("./*");
	});

	it("exposes exactly the documented supported subpaths", () => {
		expect(Object.keys(exportsMap).sort()).toEqual([".", "./testing", "./ui"]);
	});
});
