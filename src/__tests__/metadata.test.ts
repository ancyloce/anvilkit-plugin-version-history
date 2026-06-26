import { createFakePageIR } from "@anvilkit/core/testing";
import type { PageIR } from "@anvilkit/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inMemoryAdapter } from "../adapters/in-memory.js";
import { localStorageAdapter } from "../adapters/local-storage.js";
import type { SnapshotAdapter, SnapshotMeta } from "../types/types.js";
import { VersionHistoryError } from "../utils/errors.js";
import { planRetention } from "../utils/retention.js";

const NAMESPACE = "metadata";

function makeIR(headline: string): PageIR {
	return createFakePageIR({
		children: [{ id: "hero-1", type: "Hero", props: { headline } }],
	});
}

async function captureError(run: () => unknown): Promise<unknown> {
	try {
		await run();
		return undefined;
	} catch (error) {
		return error;
	}
}

function createMemoryStorage(): Storage {
	const items = new Map<string, string>();
	return {
		get length() {
			return items.size;
		},
		clear() {
			items.clear();
		},
		getItem(key: string) {
			return items.get(key) ?? null;
		},
		key(index: number) {
			return [...items.keys()][index] ?? null;
		},
		removeItem(key: string) {
			items.delete(key);
		},
		setItem(key: string, value: string) {
			items.set(key, value);
		},
	};
}

const adapterCases: ReadonlyArray<readonly [string, () => SnapshotAdapter]> = [
	["inMemoryAdapter", () => inMemoryAdapter()],
	["localStorageAdapter", () => localStorageAdapter({ namespace: NAMESPACE })],
];

describe("SnapshotMeta tagging / milestones / update", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", createMemoryStorage());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	for (const [name, makeAdapter] of adapterCases) {
		describe(name, () => {
			it("threads new optional meta fields through save -> list/load round-trip", async () => {
				const adapter = makeAdapter();
				const ir = makeIR("tagged");

				const id = await Promise.resolve(
					adapter.save(ir, {
						label: "Release candidate",
						tags: ["release", "qa"],
						milestone: true,
						protected: true,
						author: "alice@example.com",
						notes: "Frozen before the launch review.",
					}),
				);

				const [stored] = await Promise.resolve(adapter.list());
				expect(stored?.id).toBe(id);
				expect(stored?.label).toBe("Release candidate");
				expect(stored?.tags).toEqual(["release", "qa"]);
				expect(stored?.milestone).toBe(true);
				expect(stored?.protected).toBe(true);
				expect(stored?.author).toBe("alice@example.com");
				expect(stored?.notes).toBe("Frozen before the launch review.");

				// The underlying IR/delta-chain record is untouched by metadata.
				expect(await Promise.resolve(adapter.load(id))).toEqual(ir);
			});

			it("loads legacy records that omit the new fields (backward compat)", async () => {
				// Save with no extra metadata — the new fields must simply be absent,
				// not break list()/load().
				const adapter = makeAdapter();
				const ir = makeIR("legacy");
				const id = await Promise.resolve(adapter.save(ir, { label: "old" }));

				const [stored] = await Promise.resolve(adapter.list());
				expect(stored?.label).toBe("old");
				expect(stored?.tags).toBeUndefined();
				expect(stored?.milestone).toBeUndefined();
				expect(stored?.protected).toBeUndefined();
				expect(stored?.author).toBeUndefined();
				expect(stored?.notes).toBeUndefined();
				expect(await Promise.resolve(adapter.load(id))).toEqual(ir);
			});

			it("updateMeta patches only the targeted fields and leaves siblings + IR intact", async () => {
				const adapter = makeAdapter();
				if (!adapter.updateMeta) {
					throw new Error(`${name} did not implement updateMeta()`);
				}
				const ir = makeIR("editable");
				const id = await Promise.resolve(
					adapter.save(ir, {
						label: "keep-label",
						tags: ["a"],
						author: "original",
					}),
				);
				const before = (
					await Promise.resolve(adapter.list())
				)[0] as SnapshotMeta;

				await Promise.resolve(
					adapter.updateMeta(id, {
						tags: ["b", "c"],
						milestone: true,
						notes: "added later",
					}),
				);

				const after = (
					await Promise.resolve(adapter.list())
				)[0] as SnapshotMeta;
				// Patched fields changed.
				expect(after.tags).toEqual(["b", "c"]);
				expect(after.milestone).toBe(true);
				expect(after.notes).toBe("added later");
				// Untouched mutable siblings preserved.
				expect(after.label).toBe("keep-label");
				expect(after.author).toBe("original");
				// Identity / provenance fields are immutable.
				expect(after.id).toBe(id);
				expect(after.savedAt).toBe(before.savedAt);
				expect(after.pageIRHash).toBe(before.pageIRHash);
				// The stored IR is unaffected by a metadata update.
				expect(await Promise.resolve(adapter.load(id))).toEqual(ir);
			});

			it("updateMeta throws SNAPSHOT_NOT_FOUND for an unknown id", async () => {
				const adapter = makeAdapter();
				if (!adapter.updateMeta) {
					throw new Error(`${name} did not implement updateMeta()`);
				}
				await Promise.resolve(adapter.save(makeIR("x"), {}));

				const error = await captureError(() =>
					adapter.updateMeta!("does-not-exist", { label: "nope" }),
				);
				expect(error).toBeInstanceOf(VersionHistoryError);
				expect((error as VersionHistoryError).code).toBe("SNAPSHOT_NOT_FOUND");
			});

			it("protected flag set at save time is honored by planRetention", async () => {
				const adapter = makeAdapter();
				const oldId = await Promise.resolve(
					adapter.save(makeIR("oldest"), {
						pageIRHash: "old",
						protected: true,
					}),
				);
				const newId = await Promise.resolve(
					adapter.save(makeIR("newest"), { pageIRHash: "new" }),
				);

				const snapshots = await Promise.resolve(adapter.list());
				// Aggressive cap of 1 would normally evict the oldest (oldId); the
				// protected flag must spare it.
				const plan = planRetention(snapshots, { maxSnapshots: 1 });
				expect(plan.deleteIds).not.toContain(oldId);
				expect(plan.keepIds).toContain(oldId);
				expect(plan.deleteIds).toEqual([newId]);
			});
		});
	}
});

describe("localStorageAdapter metadata persistence", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", createMemoryStorage());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("persists new fields and updateMeta patches across a fresh adapter instance", async () => {
		const ir = makeIR("persisted");
		const first = localStorageAdapter({ namespace: NAMESPACE });
		const id = await Promise.resolve(
			first.save(ir, { tags: ["t1"], milestone: true, label: "v1" }),
		);

		// New adapter instance over the same storage — simulates a page reload.
		const reloaded = localStorageAdapter({ namespace: NAMESPACE });
		const [persisted] = await Promise.resolve(reloaded.list());
		expect(persisted?.tags).toEqual(["t1"]);
		expect(persisted?.milestone).toBe(true);

		await Promise.resolve(
			reloaded.updateMeta!(id, { tags: ["t1", "t2"], protected: true }),
		);

		const after = localStorageAdapter({ namespace: NAMESPACE });
		const [stored] = await Promise.resolve(after.list());
		expect(stored?.tags).toEqual(["t1", "t2"]);
		expect(stored?.protected).toBe(true);
		expect(stored?.milestone).toBe(true);
		expect(stored?.label).toBe("v1");
	});

	it("reads a legacy index entry written without the new fields", async () => {
		// Hand-craft the on-disk shape an older adapter version produced.
		const storage = globalThis.localStorage;
		const legacyMeta = {
			id: "legacy-1",
			savedAt: "2023-01-01T00:00:00.000Z",
			pageIRHash: "legacy-hash",
			label: "legacy",
		};
		const ir = makeIR("legacy-body");
		storage.setItem(
			`${NAMESPACE}:snapshots:index`,
			JSON.stringify([legacyMeta]),
		);
		storage.setItem(
			`${NAMESPACE}:snapshots:legacy-1`,
			JSON.stringify({ kind: "full", ir }),
		);

		const adapter = localStorageAdapter({ namespace: NAMESPACE });
		const [stored] = await Promise.resolve(adapter.list());
		expect(stored?.id).toBe("legacy-1");
		expect(stored?.label).toBe("legacy");
		expect(stored?.tags).toBeUndefined();
		expect(stored?.protected).toBeUndefined();
		expect(await Promise.resolve(adapter.load("legacy-1"))).toEqual(ir);
	});
});
