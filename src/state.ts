import type { StudioPluginContext } from "@anvilkit/core/types";

import { freezeSnapshotList } from "./internal.js";
import type { SnapshotAdapter, SnapshotMeta } from "./types.js";

export interface VersionHistoryRuntimeState {
	readonly adapter: SnapshotAdapter;
	readonly maxSnapshots?: number;
	snapshots: readonly SnapshotMeta[];
	saveInFlight: boolean;
}

const stateByToken = new WeakMap<object, VersionHistoryRuntimeState>();
const tokenByContext = new WeakMap<StudioPluginContext, object>();

export function bindVersionHistoryState(
	token: object,
	ctx: StudioPluginContext,
	state: VersionHistoryRuntimeState,
): void {
	state.snapshots = freezeSnapshotList(state.snapshots);
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
