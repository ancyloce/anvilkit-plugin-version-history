import {
	createFakePageIR,
	createFakeStudioContext,
	registerPlugin,
} from "@anvilkit/core/testing";
import type { PageIRNode, StudioPluginContext } from "@anvilkit/core/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { inMemoryAdapter } from "../adapters/in-memory.js";
import { createVersionHistoryPlugin } from "../plugin.js";

describe("maxSnapshots eviction", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("evicts the oldest snapshot when the eleventh save exceeds maxSnapshots: 10", async () => {
		vi.useFakeTimers();

		let currentIR = createSnapshotIR(0);
		const ctx = createFakeStudioContext({
			getData: () => asPuckData(currentIR),
		});
		const adapter = inMemoryAdapter();
		const harness = await registerPlugin(
			createVersionHistoryPlugin({ adapter, maxSnapshots: 10 }),
			{ ctx },
		);

		await harness.runInit();

		const saveAction = harness.registration.headerActions?.find(
			(action) => action.id === "version-history:save",
		);
		expect(saveAction).toBeDefined();

		let firstSnapshotId = "";

		for (let index = 0; index < 11; index += 1) {
			const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index));
			vi.setSystemTime(timestamp);
			currentIR = createSnapshotIR(index);
			await saveAction?.onClick(ctx);

			const snapshots = await Promise.resolve(adapter.list());
			if (index === 0) {
				firstSnapshotId = snapshots[0]!.id;
			}
		}

		const snapshots = await Promise.resolve(adapter.list());
		expect(snapshots).toHaveLength(10);
		expect(snapshots.some((snapshot) => snapshot.id === firstSnapshotId)).toBe(
			false,
		);
		expect(() => adapter.load(firstSnapshotId)).toThrow(/not found/i);
	});
});

function createSnapshotIR(index: number) {
	return createFakePageIR({
		rootId: `root-${index}`,
		children: [
			{
				id: `hero-${index}`,
				type: "Hero",
				props: { headline: `Snapshot ${index}` },
			} satisfies PageIRNode,
		],
		metadata: {
			createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
		},
	});
}

function asPuckData(
	ir: ReturnType<typeof createFakePageIR>,
): ReturnType<StudioPluginContext["getData"]> {
	return ir as unknown as ReturnType<StudioPluginContext["getData"]>;
}
