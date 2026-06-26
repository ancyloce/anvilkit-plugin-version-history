import { createFakePageIR } from "@anvilkit/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inMemoryAdapter } from "../adapters/in-memory.js";
import { localStorageAdapter } from "../adapters/local-storage.js";
import type { SnapshotMeta, SnapshotPage } from "../types/types.js";
import { querySnapshots } from "../utils/query.js";

function meta(id: string, savedAt: string, label?: string): SnapshotMeta {
	return label === undefined
		? { id, savedAt, pageIRHash: `hash-${id}` }
		: { id, savedAt, pageIRHash: `hash-${id}`, label };
}

const SAMPLE: readonly SnapshotMeta[] = Object.freeze([
	meta("a", "2024-01-01T00:00:00.000Z", "Draft"),
	meta("b", "2024-01-02T00:00:00.000Z", "Final review"),
	meta("c", "2024-01-03T00:00:00.000Z", "draft-2"),
	meta("d", "2024-01-04T00:00:00.000Z"),
]);

const ids = (page: SnapshotPage): readonly string[] =>
	page.items.map((item) => item.id);

describe("querySnapshots", () => {
	it("preserves input order when no sort is supplied", () => {
		expect(ids(querySnapshots(SAMPLE))).toEqual(["a", "b", "c", "d"]);
	});

	it("sorts by savedAt ascending", () => {
		const page = querySnapshots(SAMPLE, {
			sort: { field: "savedAt", direction: "asc" },
		});
		expect(ids(page)).toEqual(["a", "b", "c", "d"]);
		expect(page.nextCursor).toBeUndefined();
	});

	it("sorts by savedAt descending", () => {
		const page = querySnapshots(SAMPLE, {
			sort: { field: "savedAt", direction: "desc" },
		});
		expect(ids(page)).toEqual(["d", "c", "b", "a"]);
	});

	it("sorts by label ascending (missing label sorts first, case-sensitive)", () => {
		// labels: a="Draft", b="Final review", c="draft-2", d=<none → "">.
		// Lexical asc: "" < "Draft" < "Final review" < "draft-2".
		const page = querySnapshots(SAMPLE, {
			sort: { field: "label", direction: "asc" },
		});
		expect(ids(page)).toEqual(["d", "a", "b", "c"]);
	});

	it("sorts by label descending", () => {
		const page = querySnapshots(SAMPLE, {
			sort: { field: "label", direction: "desc" },
		});
		expect(ids(page)).toEqual(["c", "b", "a", "d"]);
	});

	it("filters by case-insensitive label substring, excluding label-less metas", () => {
		const page = querySnapshots(SAMPLE, { filter: { label: "draft" } });
		// "Draft" (a) and "draft-2" (c) match; "Final review" (b) and the
		// label-less (d) do not. Input order is preserved (no sort).
		expect(ids(page)).toEqual(["a", "c"]);
	});

	it("returns an empty page when the filter matches nothing", () => {
		const page = querySnapshots(SAMPLE, { filter: { label: "zzz" } });
		expect(page.items).toEqual([]);
		expect(page.nextCursor).toBeUndefined();
	});

	it("paginates with limit + cursor, emitting nextCursor until the final page", () => {
		const sort = { field: "savedAt", direction: "asc" } as const;

		const page1 = querySnapshots(SAMPLE, { sort, limit: 2 });
		expect(ids(page1)).toEqual(["a", "b"]);
		expect(page1.nextCursor).toBe("b");

		const page2 = querySnapshots(SAMPLE, {
			sort,
			limit: 2,
			cursor: page1.nextCursor,
		});
		expect(ids(page2)).toEqual(["c", "d"]);
		// Final page — no more items remain.
		expect(page2.nextCursor).toBeUndefined();
	});

	it("omits nextCursor when limit covers every remaining item", () => {
		const page = querySnapshots(SAMPLE, {
			sort: { field: "savedAt", direction: "asc" },
			limit: 4,
		});
		expect(ids(page)).toEqual(["a", "b", "c", "d"]);
		expect(page.nextCursor).toBeUndefined();
	});

	it("treats a non-positive or non-finite limit as 'no limit'", () => {
		expect(ids(querySnapshots(SAMPLE, { limit: 0 }))).toEqual([
			"a",
			"b",
			"c",
			"d",
		]);
		expect(ids(querySnapshots(SAMPLE, { limit: Number.NaN }))).toEqual([
			"a",
			"b",
			"c",
			"d",
		]);
	});

	it("restarts from the head when the cursor is unknown", () => {
		const page = querySnapshots(SAMPLE, {
			sort: { field: "savedAt", direction: "asc" },
			limit: 2,
			cursor: "does-not-exist",
		});
		expect(ids(page)).toEqual(["a", "b"]);
	});

	it("breaks ties on id ascending regardless of sort direction", () => {
		const tied: readonly SnapshotMeta[] = [
			meta("y", "2024-05-01T00:00:00.000Z", "same"),
			meta("x", "2024-05-01T00:00:00.000Z", "same"),
		];
		const asc = querySnapshots(tied, {
			sort: { field: "savedAt", direction: "asc" },
		});
		const desc = querySnapshots(tied, {
			sort: { field: "savedAt", direction: "desc" },
		});
		expect(ids(asc)).toEqual(["x", "y"]);
		expect(ids(desc)).toEqual(["x", "y"]);
	});

	it("does not mutate the input array", () => {
		const snapshot = [...SAMPLE];
		querySnapshots(SAMPLE, {
			sort: { field: "savedAt", direction: "desc" },
		});
		expect([...SAMPLE]).toEqual(snapshot);
	});
});

describe("adapter query() round-trip", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", createMemoryStorage());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const adapterCases: ReadonlyArray<
		readonly [string, () => import("../types/types.js").SnapshotAdapter]
	> = [
		["inMemoryAdapter", () => inMemoryAdapter()],
		["localStorageAdapter", () => localStorageAdapter({ namespace: "query" })],
	];

	for (const [name, makeAdapter] of adapterCases) {
		it(`${name}: filters saved snapshots by label`, async () => {
			const adapter = makeAdapter();
			if (!adapter.query) {
				throw new Error(`${name} did not implement query()`);
			}
			await Promise.resolve(
				adapter.save(createFakePageIR(), { label: "alpha" }),
			);
			await Promise.resolve(
				adapter.save(createFakePageIR(), { label: "beta" }),
			);
			await Promise.resolve(
				adapter.save(createFakePageIR(), { label: "alpha-2" }),
			);

			const page = await Promise.resolve(
				adapter.query({ filter: { label: "alpha" } }),
			);
			expect(page.items.map((item) => item.label)).toEqual([
				"alpha",
				"alpha-2",
			]);
		});

		it(`${name}: paginates saved snapshots via limit + cursor`, async () => {
			const adapter = makeAdapter();
			if (!adapter.query) {
				throw new Error(`${name} did not implement query()`);
			}
			for (const label of ["one", "two", "three"]) {
				await Promise.resolve(adapter.save(createFakePageIR(), { label }));
			}

			const page1 = await Promise.resolve(adapter.query({ limit: 2 }));
			expect(page1.items).toHaveLength(2);
			expect(page1.nextCursor).toBeDefined();

			const page2 = await Promise.resolve(
				adapter.query({ limit: 2, cursor: page1.nextCursor }),
			);
			expect(page2.items).toHaveLength(1);
			expect(page2.nextCursor).toBeUndefined();

			const seen = [...page1.items, ...page2.items].map((item) => item.id);
			expect(new Set(seen).size).toBe(3);
		});
	}
});

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
