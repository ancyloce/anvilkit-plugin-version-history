import { createFakePageIR } from "@anvilkit/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { localStorageAdapter } from "../adapters/local-storage.js";
import { normalizeStoredRecord } from "../adapters/snapshot-chain.js";
import { VersionHistoryError } from "../utils/errors.js";

class MemoryStorage implements Storage {
	#items = new Map<string, string>();
	get length(): number {
		return this.#items.size;
	}
	clear(): void {
		this.#items.clear();
	}
	getItem(key: string): string | null {
		return this.#items.get(key) ?? null;
	}
	key(index: number): string | null {
		return [...this.#items.keys()][index] ?? null;
	}
	removeItem(key: string): void {
		this.#items.delete(key);
	}
	setItem(key: string, value: string): void {
		this.#items.set(key, value);
	}
}

/** Assert that `fn` throws a `STORAGE_CORRUPT` {@link VersionHistoryError}. */
function expectStorageCorrupt(fn: () => unknown): void {
	let thrown: unknown;
	try {
		fn();
	} catch (error) {
		thrown = error;
	}
	expect(thrown).toBeInstanceOf(VersionHistoryError);
	expect((thrown as VersionHistoryError).code).toBe("STORAGE_CORRUPT");
}

function deltaRecord(diff: unknown) {
	return { kind: "delta", base: "keyframe-1", diff, assets: [], metadata: {} };
}

describe("normalizeStoredRecord delta-op validation", () => {
	it("accepts a well-formed delta record (one op of each kind)", () => {
		const diff = [
			{ kind: "remove-node", path: "/root/children/0", nodeId: "old" },
			{
				kind: "add-node",
				path: "/root/children/0",
				node: { id: "new", type: "Hero", props: {} },
			},
			{
				kind: "move-node",
				from: "/root/children/1",
				to: "/root/children/2",
				nodeId: "n",
			},
			{
				kind: "change-prop",
				path: "/root/props",
				key: "title",
				before: 1,
				after: 2,
			},
			{
				kind: "change-children",
				path: "/root/children",
				before: ["a"],
				after: ["a", "b"],
			},
			{
				kind: "meta-changed",
				path: "/root/meta",
				key: "locked",
				before: false,
				after: true,
			},
		];
		const record = normalizeStoredRecord(deltaRecord(diff));
		expect(record.kind).toBe("delta");
		if (record.kind === "delta") {
			expect(record.diff).toEqual(diff);
		}
	});

	it("accepts an empty delta op array (no changes is valid)", () => {
		const record = normalizeStoredRecord(deltaRecord([]));
		expect(record.kind).toBe("delta");
		if (record.kind === "delta") {
			expect(record.diff).toEqual([]);
		}
	});

	it("accepts change-prop / meta-changed ops whose undefined before/after JSON-dropped", () => {
		// JSON.stringify drops `undefined` values, so a prop-delete op stored as
		// `{ kind, path, key }` (no `after`) is well-formed and must still load.
		const diff = [
			{ kind: "change-prop", path: "/root/props", key: "title" },
			{ kind: "meta-changed", path: "/root/meta", key: "owner" },
		];
		const record = normalizeStoredRecord(deltaRecord(diff));
		expect(record.kind).toBe("delta");
	});

	it("rejects a delta op with an unknown discriminant", () => {
		expectStorageCorrupt(() =>
			normalizeStoredRecord(
				deltaRecord([{ kind: "frobnicate", path: "/root" }]),
			),
		);
	});

	it("rejects a delta op missing a required field", () => {
		// remove-node without the required string `nodeId`.
		expectStorageCorrupt(() =>
			normalizeStoredRecord(
				deltaRecord([{ kind: "remove-node", path: "/root/children/0" }]),
			),
		);
	});

	it("rejects a delta op whose `kind` is not a string", () => {
		expectStorageCorrupt(() =>
			normalizeStoredRecord(deltaRecord([{ kind: 42, path: "/root" }])),
		);
	});

	it("rejects a delta op that is not an object", () => {
		expectStorageCorrupt(() =>
			normalizeStoredRecord(deltaRecord(["not-an-op"])),
		);
	});
});

describe("localStorage stored-delta validation (end to end)", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", new MemoryStorage());
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("rejects a corrupt delta record at load() before it reaches applyDiff", () => {
		const adapter = localStorageAdapter({ namespace: "vh" });
		const baseIR = createFakePageIR({ rootId: "root" });

		localStorage.setItem(
			"vh:snapshots:index",
			JSON.stringify([
				{ id: "base", savedAt: "2026-01-01T00:00:00.000Z", pageIRHash: "h0" },
				{ id: "child", savedAt: "2026-01-02T00:00:00.000Z", pageIRHash: "h1" },
			]),
		);
		localStorage.setItem(
			"vh:snapshots:base",
			JSON.stringify({ kind: "full", ir: baseIR }),
		);
		// A delta whose op carries an unknown discriminant — if this reaches
		// `applyDiff` it throws a generic `DiffApplyError`/assertNever, not a typed
		// STORAGE_CORRUPT. The storage trust boundary must reject it first.
		localStorage.setItem(
			"vh:snapshots:child",
			JSON.stringify({
				kind: "delta",
				base: "base",
				diff: [{ kind: "frobnicate", path: "/root" }],
				assets: [],
				metadata: {},
			}),
		);

		expectStorageCorrupt(() => adapter.load("child"));
	});

	it("rejects a corrupt `delta` in an index entry at list()", () => {
		const adapter = localStorageAdapter({ namespace: "vh" });
		localStorage.setItem(
			"vh:snapshots:index",
			JSON.stringify([
				{
					id: "s1",
					savedAt: "2026-01-01T00:00:00.000Z",
					pageIRHash: "h",
					delta: [{ kind: "remove-node", path: "/root/children/0" }],
				},
			]),
		);

		expectStorageCorrupt(() => adapter.list());
	});

	it("keeps a well-formed index `delta` loadable", () => {
		const adapter = localStorageAdapter({ namespace: "vh" });
		localStorage.setItem(
			"vh:snapshots:index",
			JSON.stringify([
				{
					id: "s1",
					savedAt: "2026-01-01T00:00:00.000Z",
					pageIRHash: "h",
					delta: [
						{ kind: "remove-node", path: "/root/children/0", nodeId: "x" },
					],
				},
			]),
		);

		const list = adapter.list();
		expect(list).toHaveLength(1);
		expect(list[0]?.delta).toHaveLength(1);
	});

	it("accepts an empty index `delta` array", () => {
		const adapter = localStorageAdapter({ namespace: "vh" });
		localStorage.setItem(
			"vh:snapshots:index",
			JSON.stringify([
				{
					id: "s1",
					savedAt: "2026-01-01T00:00:00.000Z",
					pageIRHash: "h",
					delta: [],
				},
			]),
		);

		expect(adapter.list()).toHaveLength(1);
	});
});
