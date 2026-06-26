import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { inMemoryAdapter } from "../adapters/in-memory.js";
import { VersionHistoryError } from "../utils/errors.js";
import { createSnapshotNotFoundError } from "../utils/internal.js";

/**
 * `createSnapshotNotFoundError` is the single source of truth for
 * `SNAPSHOT_NOT_FOUND` failures. These tests pin BOTH halves of that contract:
 * the canonical error shape every load path must throw, and (statically) that
 * `snapshot-chain.ts` actually routes through the helper instead of
 * re-constructing the error inline — so a future inline regression fails here.
 */
describe("SNAPSHOT_NOT_FOUND unification", () => {
	it("inMemoryAdapter.load on an absent id throws the helper's canonical error", async () => {
		// Drives the real load path (adapter.load → loadFromChain) on an id that
		// was never saved.
		const adapter = inMemoryAdapter();
		const missingId = "does-not-exist";

		let thrown: unknown;
		try {
			await adapter.load(missingId);
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(VersionHistoryError);
		const error = thrown as VersionHistoryError;
		expect(error.code).toBe("SNAPSHOT_NOT_FOUND");
		// The thrown error is byte-for-byte the helper's canonical form, proving
		// the load path delegates to the single source of truth rather than a
		// divergent inline message.
		expect(error.message).toBe(createSnapshotNotFoundError(missingId).message);
	});

	it("snapshot-chain.ts routes SNAPSHOT_NOT_FOUND through the helper, not an inline VersionHistoryError", () => {
		const source = readFileSync(
			fileURLToPath(new URL("../adapters/snapshot-chain.ts", import.meta.url)),
			"utf8",
		);

		// It must import + call the single source of truth.
		expect(source).toContain("createSnapshotNotFoundError");

		// And it must NOT re-construct a SNAPSHOT_NOT_FOUND error inline, which
		// is exactly the divergence this finding eliminated.
		expect(source).not.toMatch(
			/new VersionHistoryError\(\s*["']SNAPSHOT_NOT_FOUND["']/,
		);
	});
});
