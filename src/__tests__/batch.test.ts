import { createFakePageIR } from "@anvilkit/core/testing";
import type { PageIR } from "@anvilkit/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inMemoryAdapter } from "../adapters/in-memory.js";
import { localStorageAdapter } from "../adapters/local-storage.js";
import type { SnapshotAdapter, VersionHistoryExport } from "../types/types.js";
import { normalizeVersionHistoryExport } from "../utils/archive.js";
import { VersionHistoryError } from "../utils/errors.js";

function makeIR(headline: string): PageIR {
	return createFakePageIR({
		children: [{ id: "hero-1", type: "Hero", props: { headline } }],
	});
}

/**
 * Capture an error thrown by `run`, tolerating both synchronous throws (the
 * reference adapters are sync) and rejected promises (async adapters), so the
 * assertions hold across the whole `MaybePromise` adapter surface.
 */
async function captureError(run: () => unknown): Promise<unknown> {
	try {
		await run();
		return undefined;
	} catch (error) {
		return error;
	}
}

/** Save `labels.length` distinct snapshots, returning their ids + source IRs. */
async function seed(
	adapter: SnapshotAdapter,
	labels: readonly string[],
): Promise<{ readonly ids: string[]; readonly irs: PageIR[] }> {
	const ids: string[] = [];
	const irs: PageIR[] = [];
	for (const label of labels) {
		const ir = makeIR(`content-${label}`);
		irs.push(ir);
		ids.push(
			await Promise.resolve(adapter.save(ir, { label, pageIRHash: label })),
		);
	}
	return { ids, irs };
}

const adapterCases: ReadonlyArray<readonly [string, () => SnapshotAdapter]> = [
	["inMemoryAdapter", () => inMemoryAdapter()],
	["localStorageAdapter", () => localStorageAdapter({ namespace: "batch" })],
];

describe("SnapshotAdapter batch capabilities", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", createMemoryStorage());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	for (const [name, makeAdapter] of adapterCases) {
		describe(name, () => {
			it("deleteMany removes the requested ids and leaves the rest loadable", async () => {
				const adapter = makeAdapter();
				if (!adapter.deleteMany) {
					throw new Error(`${name} did not implement deleteMany()`);
				}
				const { ids, irs } = await seed(adapter, ["a", "b", "c", "d", "e"]);

				// Delete the first (keyframe) + a middle delta. Remaining chains
				// must re-root and stay loadable.
				await Promise.resolve(adapter.deleteMany([ids[0]!, ids[2]!]));

				const remaining = await Promise.resolve(adapter.list());
				expect(remaining.map((meta) => meta.id)).toEqual([
					ids[1]!,
					ids[3]!,
					ids[4]!,
				]);

				for (const index of [1, 3, 4]) {
					const loaded = await Promise.resolve(adapter.load(ids[index]!));
					expect(loaded).toEqual(irs[index]!);
				}
				const deletedError = await captureError(() => adapter.load(ids[0]!));
				expect(deletedError).toBeInstanceOf(VersionHistoryError);
				expect(String((deletedError as Error).message)).toMatch(/not found/i);
			});

			it("deleteMany ignores unknown ids", async () => {
				const adapter = makeAdapter();
				if (!adapter.deleteMany) {
					throw new Error(`${name} did not implement deleteMany()`);
				}
				const { ids } = await seed(adapter, ["a", "b"]);

				await Promise.resolve(adapter.deleteMany([ids[0]!, "does-not-exist"]));
				const remaining = await Promise.resolve(adapter.list());
				expect(remaining.map((meta) => meta.id)).toEqual([ids[1]!]);
			});

			it("exportAll materializes full IRs in save order", async () => {
				const adapter = makeAdapter();
				if (!adapter.exportAll) {
					throw new Error(`${name} did not implement exportAll()`);
				}
				const { ids, irs } = await seed(adapter, ["a", "b", "c", "d"]);

				const archive = await Promise.resolve(adapter.exportAll());
				expect(archive.version).toBe(1);
				expect(archive.snapshots.map((entry) => entry.meta.id)).toEqual(ids);
				archive.snapshots.forEach((entry, index) => {
					// Each exported `ir` is a fully-reconstructed page, not a delta.
					expect(entry.ir).toEqual(irs[index]!);
				});
			});

			it("exportAll -> importAll round-trips into a fresh adapter (loadable IRs)", async () => {
				const source = makeAdapter();
				if (!source.exportAll) {
					throw new Error(`${name} did not implement exportAll()`);
				}
				const { ids, irs } = await seed(source, ["a", "b", "c", "d", "e"]);
				const archive = await Promise.resolve(source.exportAll());

				const fresh = makeAdapter();
				if (!fresh.importAll) {
					throw new Error(`${name} did not implement importAll()`);
				}
				await Promise.resolve(fresh.importAll(archive));

				const restored = await Promise.resolve(fresh.list());
				expect(restored.map((meta) => meta.id)).toEqual(ids);
				// Metadata is preserved verbatim, not regenerated.
				expect(restored.map((meta) => meta.label)).toEqual([
					"a",
					"b",
					"c",
					"d",
					"e",
				]);
				for (let index = 0; index < ids.length; index += 1) {
					const loaded = await Promise.resolve(fresh.load(ids[index]!));
					expect(loaded).toEqual(irs[index]!);
				}
			});

			it("importAll replace clears existing snapshots first", async () => {
				const adapter = makeAdapter();
				if (!adapter.exportAll || !adapter.importAll) {
					throw new Error(`${name} did not implement export/import`);
				}
				// Build an archive from a separate source.
				const source = makeAdapter();
				const { ids: archiveIds } = await seed(source, ["x", "y"]);
				const archive = await Promise.resolve(source.exportAll!());

				// Pre-populate the target with unrelated snapshots.
				vi.unstubAllGlobals();
				vi.stubGlobal("localStorage", createMemoryStorage());
				const target = makeAdapter();
				const { ids: staleIds } = await seed(target, ["old-1", "old-2"]);

				await Promise.resolve(target.importAll!(archive, { mode: "replace" }));

				const after = await Promise.resolve(target.list());
				expect(after.map((meta) => meta.id)).toEqual(archiveIds);
				for (const staleId of staleIds) {
					const staleError = await captureError(() => target.load(staleId));
					expect(staleError).toBeInstanceOf(VersionHistoryError);
					expect(String((staleError as Error).message)).toMatch(/not found/i);
				}
			});

			it("importAll merge adds new ids and overwrites colliding ones", async () => {
				const adapter = makeAdapter();
				if (!adapter.exportAll || !adapter.importAll) {
					throw new Error(`${name} did not implement export/import`);
				}
				const { ids: existingIds, irs: existingIrs } = await seed(adapter, [
					"keep",
				]);
				const keepId = existingIds[0]!;

				// Craft an archive: one brand-new id + one that overwrites keepId
				// with different content.
				const overwriteIR = makeIR("overwritten");
				const newIR = makeIR("brand-new");
				const archive: VersionHistoryExport = {
					version: 1,
					snapshots: [
						{
							meta: {
								id: keepId,
								savedAt: "2099-01-01T00:00:00.000Z",
								pageIRHash: "overwrite",
								label: "overwritten",
							},
							ir: overwriteIR,
						},
						{
							meta: {
								id: "imported-new",
								savedAt: "2099-01-02T00:00:00.000Z",
								pageIRHash: "new",
								label: "brand-new",
							},
							ir: newIR,
						},
					],
				};

				await Promise.resolve(adapter.importAll!(archive, { mode: "merge" }));

				const after = await Promise.resolve(adapter.list());
				const afterById = new Map(after.map((meta) => [meta.id, meta]));
				// keepId retained its position and now carries overwritten content.
				expect(after.map((meta) => meta.id)).toEqual([keepId, "imported-new"]);
				expect(afterById.get(keepId)?.label).toBe("overwritten");

				expect(await Promise.resolve(adapter.load(keepId))).toEqual(
					overwriteIR,
				);
				expect(await Promise.resolve(adapter.load("imported-new"))).toEqual(
					newIR,
				);
				// Sanity: the pre-import content is gone after the overwrite.
				expect(await Promise.resolve(adapter.load(keepId))).not.toEqual(
					existingIrs[0]!,
				);
			});

			it("importAll merge re-roots existing delta dependents of an overwritten base", async () => {
				const adapter = makeAdapter();
				if (!adapter.importAll) {
					throw new Error(`${name} did not implement importAll()`);
				}
				// A = keyframe, B = delta on A (minimal prop change keeps it a delta).
				const { ids, irs } = await seed(adapter, ["A", "B"]);
				const [baseId, dependentId] = ids;
				const dependentIR = irs[1]!;

				// Overwrite ONLY A with brand-new content; leave B out of the
				// archive. If the dependent were not re-rooted, B would replay its
				// diff onto the new A and reconstruct to the wrong page.
				const newBaseIR = makeIR("rewritten-base");
				const archive: VersionHistoryExport = {
					version: 1,
					snapshots: [
						{
							meta: {
								id: baseId!,
								savedAt: "2099-01-01T00:00:00.000Z",
								pageIRHash: "new-base",
							},
							ir: newBaseIR,
						},
					],
				};

				await Promise.resolve(adapter.importAll!(archive, { mode: "merge" }));

				// B still reconstructs to its original content (it was promoted to
				// a standalone keyframe before A was overwritten).
				expect(await Promise.resolve(adapter.load(dependentId!))).toEqual(
					dependentIR,
				);
				expect(await Promise.resolve(adapter.load(baseId!))).toEqual(newBaseIR);
			});

			it("importAll rejects a malformed archive without mutating", async () => {
				const adapter = makeAdapter();
				if (!adapter.importAll) {
					throw new Error(`${name} did not implement importAll()`);
				}
				const { ids } = await seed(adapter, ["a"]);

				const importError = await captureError(() =>
					adapter.importAll!({
						version: 2,
					} as unknown as VersionHistoryExport),
				);
				expect(importError).toBeInstanceOf(VersionHistoryError);
				expect((importError as VersionHistoryError).code).toBe(
					"STORAGE_CORRUPT",
				);

				// Store is untouched.
				const after = await Promise.resolve(adapter.list());
				expect(after.map((meta) => meta.id)).toEqual(ids);
			});
		});
	}
});

describe("normalizeVersionHistoryExport", () => {
	const goodEntry = () => ({
		meta: {
			id: "id-1",
			savedAt: "2024-01-01T00:00:00.000Z",
			pageIRHash: "h",
		},
		ir: makeIR("ok"),
	});

	it("accepts and freezes a well-formed archive, preserving entry order", () => {
		const archive = normalizeVersionHistoryExport({
			version: 1,
			snapshots: [
				{ ...goodEntry(), meta: { ...goodEntry().meta, id: "id-1" } },
				{ ...goodEntry(), meta: { ...goodEntry().meta, id: "id-2" } },
			],
		});
		expect(archive.version).toBe(1);
		expect(archive.snapshots.map((entry) => entry.meta.id)).toEqual([
			"id-1",
			"id-2",
		]);
		expect(Object.isFrozen(archive)).toBe(true);
		expect(Object.isFrozen(archive.snapshots)).toBe(true);
	});

	it("drops extraneous meta fields (normalizes)", () => {
		const archive = normalizeVersionHistoryExport({
			version: 1,
			snapshots: [
				{
					meta: {
						id: "id-1",
						savedAt: "2024-01-01T00:00:00.000Z",
						pageIRHash: "h",
						bogus: "should-be-dropped",
					},
					ir: makeIR("ok"),
				},
			],
		});
		expect(archive.snapshots[0]!.meta).not.toHaveProperty("bogus");
	});

	const malformed: ReadonlyArray<readonly [string, unknown]> = [
		["not an object", 42],
		["null", null],
		["wrong version", { version: 2, snapshots: [] }],
		["snapshots not an array", { version: 1, snapshots: {} }],
		[
			"entry missing ir",
			{ version: 1, snapshots: [{ meta: goodEntry().meta }] },
		],
		[
			"entry ir not a PageIR",
			{
				version: 1,
				snapshots: [{ meta: goodEntry().meta, ir: { nope: true } }],
			},
		],
		[
			"meta missing id",
			{
				version: 1,
				snapshots: [
					{ meta: { savedAt: "x", pageIRHash: "h" }, ir: makeIR("ok") },
				],
			},
		],
		[
			"meta delta wrong type",
			{
				version: 1,
				snapshots: [
					{
						meta: { ...goodEntry().meta, delta: "not-array" },
						ir: makeIR("ok"),
					},
				],
			},
		],
	];

	for (const [label, input] of malformed) {
		it(`rejects ${label} with a STORAGE_CORRUPT error`, () => {
			let thrown: unknown;
			try {
				normalizeVersionHistoryExport(input);
			} catch (error) {
				thrown = error;
			}
			expect(thrown).toBeInstanceOf(VersionHistoryError);
			expect((thrown as VersionHistoryError).code).toBe("STORAGE_CORRUPT");
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
