import type { PageIR, StudioHeaderAction } from "@anvilkit/core/types";

import { evictOldest } from "./eviction.js";
import { hashPageIR } from "./hash.js";
import { getVersionHistoryState, setVersionHistorySnapshots } from "./state.js";

export const saveSnapshotAction: StudioHeaderAction = {
	id: "version-history:save",
	label: "Save snapshot",
	icon: "camera",
	group: "secondary",
	order: 120,
	async onClick(ctx) {
		ctx.log("info", "Version history save requested.");

		const state = getVersionHistoryState(ctx);
		if (!state) {
			ctx.log(
				"warn",
				"Version history save requested before the plugin completed onInit.",
			);
			return;
		}

		if (state.saveInFlight) {
			ctx.log(
				"info",
				"Version history save skipped because another save is already in flight.",
			);
			return;
		}

		const ir = toPageIR(ctx.getData());
		if (!ir) {
			ctx.log(
				"info",
				"Version history save deferred until phase5-013 wires Puck data to PageIR conversion.",
			);
			return;
		}

		state.saveInFlight = true;
		try {
			const id = await Promise.resolve(
				state.adapter.save(ir, {
					pageIRHash: hashPageIR(ir),
				}),
			);

			let snapshots = await Promise.resolve(state.adapter.list());

			if (state.maxSnapshots !== undefined) {
				const idsToDelete = evictOldest(snapshots, state.maxSnapshots);
				if (idsToDelete.length > 0) {
					if (!state.adapter.delete) {
						ctx.log(
							"warn",
							"Version history maxSnapshots overflow could not evict because adapter.delete is unavailable.",
							{
								maxSnapshots: state.maxSnapshots,
								overflowIds: idsToDelete,
							},
						);
					} else {
						for (const snapshotId of idsToDelete) {
							await Promise.resolve(state.adapter.delete(snapshotId));
						}
						snapshots = await Promise.resolve(state.adapter.list());
					}
				}
			}

			setVersionHistorySnapshots(ctx, snapshots);
			ctx.log("info", "Version history snapshot saved.", {
				id,
				snapshotCount: snapshots.length,
			});
		} finally {
			state.saveInFlight = false;
		}
	},
};

export const openHistoryAction: StudioHeaderAction = {
	id: "version-history:open",
	label: "Open history",
	icon: "history",
	group: "secondary",
	order: 121,
	onClick(ctx) {
		const state = getVersionHistoryState(ctx);
		ctx.log("info", "Version history open requested.", {
			snapshotCount: state?.snapshots.length ?? 0,
		});
	},
};

function toPageIR(value: unknown): PageIR | null {
	if (value === null || typeof value !== "object") {
		return null;
	}

	const maybeIR = value as Partial<PageIR>;
	if (maybeIR.version !== "1") {
		return null;
	}

	if (!maybeIR.root || typeof maybeIR.root !== "object") {
		return null;
	}

	if (!Array.isArray(maybeIR.assets)) {
		return null;
	}

	if (!maybeIR.metadata || typeof maybeIR.metadata !== "object") {
		return null;
	}

	return maybeIR as PageIR;
}
