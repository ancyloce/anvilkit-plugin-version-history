import { describe, expect, it } from "vitest";

import { inMemoryAdapter } from "../adapters/in-memory.js";
import packageJson from "../../package.json";
import { createVersionHistoryPlugin } from "../plugin.js";

/**
 * Metadata drift guard: `META.version` is derived from package.json, so
 * a Changesets bump can never leave the runtime metadata stale.
 */
describe("plugin metadata drift", () => {
	it("meta.version matches package.json version", () => {
		const plugin = createVersionHistoryPlugin({
			adapter: inMemoryAdapter(),
		});
		expect(plugin.meta.version).toBe(packageJson.version);
	});
});
