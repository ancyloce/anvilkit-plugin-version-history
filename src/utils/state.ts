import type { StudioPluginContext } from "@anvilkit/core/types";
import type {
	BuildPageIR,
	CanvasSnapshotReference,
	SnapshotAdapter,
	SnapshotMeta,
} from "../types/types.js";
import { freezeSnapshotList } from "./internal.js";

export interface VersionHistoryRuntimeState {
	readonly adapter: SnapshotAdapter;
	readonly buildIR?: BuildPageIR;
	readonly maxSnapshots?: number;
	snapshots: readonly SnapshotMeta[];
	saveInFlight: boolean;
	canvasSnapshots: readonly CanvasSnapshotReference[];
}

const stateByToken = new WeakMap<object, VersionHistoryRuntimeState>();
const tokenByContext = new WeakMap<StudioPluginContext, object>();

export function bindVersionHistoryState(
	token: object,
	ctx: StudioPluginContext,
	state: VersionHistoryRuntimeState,
): void {
	state.snapshots = freezeSnapshotList(state.snapshots);
	state.canvasSnapshots = Object.freeze([...state.canvasSnapshots]);
	stateByToken.set(token, state);
	tokenByContext.set(ctx, token);
}

export function unbindVersionHistoryState(
	token: object,
	ctx: StudioPluginContext,
): void {
	tokenByContext.delete(ctx);
	stateByToken.delete(token);
}

export function getVersionHistoryState(
	ctx: StudioPluginContext,
): VersionHistoryRuntimeState | undefined {
	const token = tokenByContext.get(ctx);
	return token ? stateByToken.get(token) : undefined;
}

export function setVersionHistorySnapshots(
	ctx: StudioPluginContext,
	snapshots: readonly SnapshotMeta[],
): void {
	const state = getVersionHistoryState(ctx);
	if (!state) {
		return;
	}

	state.snapshots = freezeSnapshotList(snapshots);
}

/**
 * Append a canvas-keyspace snapshot reference (FR-073). Append-only,
 * mirroring `CanvasSnapshotBridge.restoreSnapshot`'s own "restore appends,
 * never mutates" contract — a repeated `designId`/`snapshotId` pair (e.g. a
 * duplicate event delivery) is skipped rather than pushed twice.
 */
export function appendCanvasSnapshotReference(
	ctx: StudioPluginContext,
	reference: CanvasSnapshotReference,
): void {
	const state = getVersionHistoryState(ctx);
	if (!state) {
		return;
	}
	const alreadyRecorded = state.canvasSnapshots.some(
		(existing) =>
			existing.designId === reference.designId &&
			existing.snapshotId === reference.snapshotId,
	);
	if (alreadyRecorded) {
		return;
	}
	state.canvasSnapshots = Object.freeze([...state.canvasSnapshots, reference]);
}
