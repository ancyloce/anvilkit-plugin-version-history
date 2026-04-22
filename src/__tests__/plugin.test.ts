import { compilePlugins } from "@anvilkit/core";
import {
	createFakePageIR,
	createFakeStudioContext,
	registerPlugin,
} from "@anvilkit/core/testing";
import type { StudioPluginContext } from "@anvilkit/core/types";
import { describe, expect, it, vi } from "vitest";

import { inMemoryAdapter } from "../adapters/in-memory.js";
import { createVersionHistoryPlugin } from "../plugin.js";
import type { SnapshotAdapter } from "../types.js";

describe("createVersionHistoryPlugin", () => {
	it("compiles through compilePlugins and contributes the expected header actions", async () => {
		const runtime = await compilePlugins(
			[createVersionHistoryPlugin({ adapter: inMemoryAdapter() })],
			createFakeStudioContext(),
		);

		expect(runtime.pluginMeta).toHaveLength(1);
		expect(runtime.pluginMeta[0]?.id).toBe("anvilkit-plugin-version-history");
		expect(runtime.headerActions.map((action) => action.id)).toEqual([
			"version-history:save",
			"version-history:open",
		]);
	});

	it("runs onInit and primes snapshots from adapter.list()", async () => {
		const adapter: SnapshotAdapter = {
			save: vi.fn(() => "snapshot-1"),
			list: vi.fn(() => []),
			load: vi.fn(),
			delete: vi.fn(),
		};
		const harness = await registerPlugin(
			createVersionHistoryPlugin({ adapter }),
			{ ctx: createFakeStudioContext() },
		);

		await harness.runInit();

		expect(adapter.list).toHaveBeenCalledTimes(1);
		expect(harness.registration.headerActions?.map((action) => action.id)).toEqual(
			["version-history:save", "version-history:open"],
		);
	});

	it("saves and reloads a snapshot when ctx.getData() already returns PageIR", async () => {
		const adapter = inMemoryAdapter();
		const ir = createFakePageIR({
			rootId: "page-ir-root",
			metadata: { createdAt: new Date(0).toISOString() },
		});
		const ctx = createFakeStudioContext({
			getData: () => asPuckData(ir),
		});
		const harness = await registerPlugin(
			createVersionHistoryPlugin({ adapter }),
			{ ctx },
		);

		await harness.runInit();

		const action = harness.registration.headerActions?.find(
			(candidate) => candidate.id === "version-history:save",
		);
		await action?.onClick(ctx);

		const snapshots = await Promise.resolve(adapter.list());
		expect(snapshots).toHaveLength(1);
		expect(ctx._mocks.emitCalls.map(([event]) => event)).toContain(
			"version-history:save-requested",
		);

		const loaded = await Promise.resolve(adapter.load(snapshots[0]!.id));
		expect(loaded).toEqual(ir);
	});
});

function asPuckData(
	ir: ReturnType<typeof createFakePageIR>,
): ReturnType<StudioPluginContext["getData"]> {
	return ir as unknown as ReturnType<StudioPluginContext["getData"]>;
}
