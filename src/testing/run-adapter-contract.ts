import { createFakePageIR } from "@anvilkit/core/testing";

import type { SnapshotAdapter } from "../types.js";

type DescribeLike = (name: string, fn: () => void) => void;
type ItLike = (name: string, fn: () => void | Promise<void>) => void;
type ExpectLike = {
	(actual: unknown): {
		toBe(expected: unknown): void;
		toBeDefined(): void;
		toBeGreaterThan(expected: number): void;
		toBeUndefined(): void;
		toEqual(expected: unknown): void;
	};
};

export interface RunAdapterContractOptions {
	readonly describe?: DescribeLike;
	readonly expect?: ExpectLike;
	readonly it?: ItLike;
}

export function runAdapterContract(
	makeAdapter: () => SnapshotAdapter,
	options: RunAdapterContractOptions = {},
): void {
	const describeImpl = options.describe ?? getGlobalTestFn<DescribeLike>("describe");
	const itImpl = options.it ?? getGlobalTestFn<ItLike>("it");
	const expectImpl = options.expect ?? getGlobalTestFn<ExpectLike>("expect");

	describeImpl("SnapshotAdapter contract", () => {
		itImpl("lists no snapshots before the first save", async () => {
			const adapter = makeAdapter();
			const snapshots = await Promise.resolve(adapter.list());

			expectImpl(snapshots).toEqual([]);
		});

		itImpl("save returns an id that is reflected by list()", async () => {
			const adapter = makeAdapter();
			const ir = createFakePageIR();

			const id = await Promise.resolve(adapter.save(ir, {}));
			const snapshots = await Promise.resolve(adapter.list());
			const entry = snapshots.find((snapshot) => snapshot.id === id);

			expectImpl(typeof id).toBe("string");
			expectImpl(id.length).toBeGreaterThan(0);
			expectImpl(entry).toBeDefined();
			expectImpl(typeof entry?.pageIRHash).toBe("string");
		});

		itImpl("load returns a structurally equal PageIR", async () => {
			const adapter = makeAdapter();
			const ir = createFakePageIR({
				rootId: "contract-root",
				metadata: { createdAt: new Date(0).toISOString() },
			});

			const id = await Promise.resolve(adapter.save(ir, {}));
			const loaded = await Promise.resolve(adapter.load(id));

			expectImpl(loaded).toEqual(ir);
		});

		itImpl("delete removes a saved snapshot when the adapter implements delete()", async () => {
			const adapter = makeAdapter();
			if (!adapter.delete) {
				expectImpl(adapter.delete).toBeUndefined();
				return;
			}

			const id = await Promise.resolve(adapter.save(createFakePageIR(), {}));
			await Promise.resolve(adapter.delete(id));
			const snapshots = await Promise.resolve(adapter.list());

			expectImpl(snapshots.find((snapshot) => snapshot.id === id)).toBeUndefined();
		});
	});
}

function getGlobalTestFn<T>(name: "describe" | "expect" | "it"): T {
	const candidate = (globalThis as Record<string, unknown>)[name];
	if (typeof candidate === "function") {
		return candidate as T;
	}

	throw new Error(
		`runAdapterContract requires ${name} to be passed explicitly when test globals are disabled.`,
	);
}
