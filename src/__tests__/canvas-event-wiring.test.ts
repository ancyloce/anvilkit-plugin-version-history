import {
	createFakeStudioContext,
	registerPlugin,
} from "@anvilkit/core/testing";
import {
	CANVAS_KEYSPACE,
	OPEN_REQUESTED_EVENT,
	SAVE_REQUESTED_EVENT,
} from "@anvilkit/plugin-canvas-studio/state/canvas-snapshot-bridge";
import { describe, expect, it, vi } from "vitest";
import { inMemoryAdapter } from "../adapters/in-memory.js";
import { createVersionHistoryPlugin } from "../plugin.js";
import { getVersionHistoryState } from "../utils/state.js";

describe("createVersionHistoryPlugin — canvas keyspace event consumption (FR-073)", () => {
	it("records a CanvasSnapshotReference when a canvas-keyspace save-requested event is delivered", async () => {
		const ctx = createFakeStudioContext();
		const harness = await registerPlugin(
			createVersionHistoryPlugin({ adapter: inMemoryAdapter() }),
			{ ctx },
		);
		await harness.runInit();

		ctx.emit(SAVE_REQUESTED_EVENT, {
			keyspace: CANVAS_KEYSPACE,
			designId: "d1",
			snapshotId: "snap-1",
		});

		const state = getVersionHistoryState(ctx);
		expect(state?.canvasSnapshots).toHaveLength(1);
		expect(state?.canvasSnapshots[0]).toMatchObject({
			keyspace: "canvas",
			designId: "d1",
			snapshotId: "snap-1",
		});
	});

	it("ignores its own bare Puck-page save-requested emit (no payload)", async () => {
		const ctx = createFakeStudioContext();
		const harness = await registerPlugin(
			createVersionHistoryPlugin({ adapter: inMemoryAdapter() }),
			{ ctx },
		);
		await harness.runInit();

		const action = harness.registration.headerActions?.find(
			(candidate) => candidate.id === "version-history:save",
		);
		await action?.onClick(ctx);

		expect(getVersionHistoryState(ctx)?.canvasSnapshots).toEqual([]);
	});

	it("ignores a save-requested event with no snapshotId (e.g. a failed save upstream)", async () => {
		const ctx = createFakeStudioContext();
		const harness = await registerPlugin(
			createVersionHistoryPlugin({ adapter: inMemoryAdapter() }),
			{ ctx },
		);
		await harness.runInit();

		ctx.emit(SAVE_REQUESTED_EVENT, {
			keyspace: CANVAS_KEYSPACE,
			designId: "d1",
		});

		expect(getVersionHistoryState(ctx)?.canvasSnapshots).toEqual([]);
	});

	it("does not record a duplicate reference for a repeated designId/snapshotId pair", async () => {
		const ctx = createFakeStudioContext();
		const harness = await registerPlugin(
			createVersionHistoryPlugin({ adapter: inMemoryAdapter() }),
			{ ctx },
		);
		await harness.runInit();

		const payload = {
			keyspace: CANVAS_KEYSPACE,
			designId: "d1",
			snapshotId: "snap-1",
		};
		ctx.emit(SAVE_REQUESTED_EVENT, payload);
		ctx.emit(SAVE_REQUESTED_EVENT, payload);

		expect(getVersionHistoryState(ctx)?.canvasSnapshots).toHaveLength(1);
	});

	it("logs (rather than throws) on a canvas-keyspace open-requested event", async () => {
		const logSpy = vi.fn();
		const baseCtx = createFakeStudioContext();
		const ctx: typeof baseCtx = { ...baseCtx, log: logSpy };
		const harness = await registerPlugin(
			createVersionHistoryPlugin({ adapter: inMemoryAdapter() }),
			{ ctx },
		);
		await harness.runInit();

		expect(() =>
			ctx.emit(OPEN_REQUESTED_EVENT, {
				keyspace: CANVAS_KEYSPACE,
				designId: "d1",
			}),
		).not.toThrow();
		expect(logSpy).toHaveBeenCalledWith(
			"info",
			expect.stringContaining("Canvas history open requested"),
			expect.objectContaining({ designId: "d1" }),
		);
	});

	it("unsubscribes from canvas events on destroy", async () => {
		const ctx = createFakeStudioContext();
		const harness = await registerPlugin(
			createVersionHistoryPlugin({ adapter: inMemoryAdapter() }),
			{ ctx },
		);
		await harness.runInit();
		await harness.runDestroy();

		expect(() =>
			ctx.emit(SAVE_REQUESTED_EVENT, {
				keyspace: CANVAS_KEYSPACE,
				designId: "d1",
				snapshotId: "snap-1",
			}),
		).not.toThrow();
	});
});
