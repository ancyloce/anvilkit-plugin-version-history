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
import type { SnapshotAdapter } from "../types/types.js";

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
		expect(
			harness.registration.headerActions?.map((action) => action.id),
		).toEqual(["version-history:save", "version-history:open"]);
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

	it("converts host Puck data to PageIR through the buildIR option and saves", async () => {
		const adapter = inMemoryAdapter();
		const ir = createFakePageIR({
			rootId: "converted-root",
			metadata: { createdAt: new Date(0).toISOString() },
		});
		// Real Studio data: a Puck document, NOT a PageIR — the `toPageIR`
		// fast-path rejects it, so the save must flow through `buildIR`.
		const puckData = {
			root: { props: { title: "Home" } },
			content: [],
			zones: {},
		} as unknown as ReturnType<StudioPluginContext["getData"]>;
		const buildIR = vi.fn(async (data: unknown) =>
			data === puckData ? ir : null,
		);
		const ctx = createFakeStudioContext({ getData: () => puckData });
		const harness = await registerPlugin(
			createVersionHistoryPlugin({ adapter, buildIR }),
			{ ctx },
		);

		await harness.runInit();

		const action = harness.registration.headerActions?.find(
			(candidate) => candidate.id === "version-history:save",
		);
		await action?.onClick(ctx);

		expect(buildIR).toHaveBeenCalledTimes(1);
		expect(buildIR).toHaveBeenCalledWith(puckData);

		const snapshots = await Promise.resolve(adapter.list());
		expect(snapshots).toHaveLength(1);

		const loaded = await Promise.resolve(adapter.load(snapshots[0]!.id));
		expect(loaded).toEqual(ir);
	});

	it("prefers the PageIR fast-path and skips buildIR when data is already PageIR", async () => {
		const adapter = inMemoryAdapter();
		const ir = createFakePageIR({ rootId: "already-ir" });
		const buildIR = vi.fn(() => null);
		const ctx = createFakeStudioContext({ getData: () => asPuckData(ir) });
		const harness = await registerPlugin(
			createVersionHistoryPlugin({ adapter, buildIR }),
			{ ctx },
		);

		await harness.runInit();

		const action = harness.registration.headerActions?.find(
			(candidate) => candidate.id === "version-history:save",
		);
		await action?.onClick(ctx);

		expect(buildIR).not.toHaveBeenCalled();
		const snapshots = await Promise.resolve(adapter.list());
		expect(snapshots).toHaveLength(1);
	});

	it("registers a StudioHistoryPanel through ctx.registerHistoryPanel when renderPanel is provided", async () => {
		const runtime = await compilePlugins(
			[
				createVersionHistoryPlugin({
					adapter: inMemoryAdapter(),
					renderPanel: () => "version-history-panel-body",
				}),
			],
			createFakeStudioContext(),
		);

		// The panel lands in the runtime sidebar registry's `history` slot —
		// the same slot `HistoryModule` renders and `SidebarRail` gates its
		// tab on (`historyPanel !== null`).
		expect(runtime.sidebar.historyPanel).not.toBeNull();
		// `render()` is the host-owned body core's `HistoryModule` invokes.
		expect(runtime.sidebar.historyPanel?.render()).toBe(
			"version-history-panel-body",
		);
	});

	it("contributes no history panel when renderPanel is omitted (backward compatible)", async () => {
		const runtime = await compilePlugins(
			[createVersionHistoryPlugin({ adapter: inMemoryAdapter() })],
			createFakeStudioContext(),
		);

		expect(runtime.sidebar.historyPanel).toBeNull();
	});

	it("unregisters the history panel on destroy (auto-teardown)", async () => {
		let registered = 0;
		let unregistered = 0;
		const baseCtx = createFakeStudioContext();
		const ctx: typeof baseCtx = {
			...baseCtx,
			registerHistoryPanel: () => {
				registered += 1;
				return () => {
					unregistered += 1;
				};
			},
		};

		const harness = await registerPlugin(
			createVersionHistoryPlugin({
				adapter: inMemoryAdapter(),
				renderPanel: () => "version-history-panel-body",
			}),
			{ ctx },
		);

		expect(registered).toBe(1);
		expect(unregistered).toBe(0);

		await harness.runDestroy();

		expect(unregistered).toBe(1);
	});

	it("no-ops without buildIR when ctx.getData() is not already PageIR", async () => {
		const adapter = inMemoryAdapter();
		const ctx = createFakeStudioContext({
			getData: () => ({ root: { props: {} }, content: [], zones: {} }),
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
		expect(snapshots).toHaveLength(0);
	});
});

function asPuckData(
	ir: ReturnType<typeof createFakePageIR>,
): ReturnType<StudioPluginContext["getData"]> {
	return ir as unknown as ReturnType<StudioPluginContext["getData"]>;
}
