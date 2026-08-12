import type { PageIR, StudioHeaderAction } from "@anvilkit/core/types";

import { evictOldest } from "../utils/eviction.js";
import { hashPageIR } from "../utils/hash.js";
import {
	getVersionHistoryState,
	setVersionHistorySnapshots,
} from "../utils/state.js";

export const saveSnapshotAction: StudioHeaderAction = {
	id: "version-history:save",
	labelKey: "versionHistory.action.save",
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

		// Guard the in-flight flag around the conversion too, so an async
		// `buildIR` bridge cannot race a second click into a duplicate save.
		state.saveInFlight = true;
		try {
			const data = ctx.getData();
			// Fast-path: data already in PageIR shape (e.g. a headless host).
			// Otherwise defer to the host-provided `buildIR` bridge so a real
			// `<Studio>` session — where `ctx.getData()` returns Puck data —
			// can still persist a snapshot.
			let ir = toPageIR(data);
			if (!ir && state.buildIR) {
				ir = await Promise.resolve(state.buildIR(data));
			}
			if (!ir) {
				ctx.log(
					"info",
					state.buildIR
						? "Version history save skipped because buildIR returned no PageIR for the current editor data."
						: "Version history save skipped because the editor data is not PageIR and no buildIR option was provided.",
				);
				return;
			}

			const id = await Promise.resolve(
				state.adapter.save(ir, {
					pageIRHash: hashPageIR(ir),
				}),
			);

			let snapshots = await Promise.resolve(state.adapter.list());

			if (state.maxSnapshots !== undefined) {
				const idsToDelete = evictOldest(snapshots, state.maxSnapshots);
				if (idsToDelete.length > 0) {
					if (state.adapter.deleteMany) {
						// Prefer the batch path so retention is a single store
						// mutation instead of one delete call per id.
						await Promise.resolve(state.adapter.deleteMany(idsToDelete));
						snapshots = await Promise.resolve(state.adapter.list());
					} else if (state.adapter.delete) {
						for (const snapshotId of idsToDelete) {
							await Promise.resolve(state.adapter.delete(snapshotId));
						}
						snapshots = await Promise.resolve(state.adapter.list());
					} else {
						ctx.log(
							"warn",
							"Version history maxSnapshots overflow could not evict because the adapter implements neither deleteMany nor delete.",
							{
								maxSnapshots: state.maxSnapshots,
								overflowIds: idsToDelete,
							},
						);
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
	labelKey: "versionHistory.action.open",
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

/**
 * Tolerant admission parse for `ctx.getData()` (`p6-005`).
 *
 * Envelope-only: it checks the four `PageIR` envelope members and never
 * inspects `root.props` or any node's props, so a canonical document and
 * a pre-rewrite one are admitted by exactly the same code. The `version`
 * compared here is the **`PageIR` envelope version**, not an
 * authoring-schema version — PLAN-0026 §5 removes the document's version
 * markers (`authoringSchemaVersion`, `appearance.version`), not the IR
 * envelope's, and nothing in this package reads the former.
 *
 * `p7-002` migrated the store, so every admitted document is canonical
 * by construction and the migration window this parse was written for is
 * closed. The envelope check stays because it is an envelope check.
 * Do not add a version branch here — the host owns migrating anything
 * out of contract, on both the save side (its `buildIR` bridge) and the
 * restore side (see `utils/restore.ts`).
 */
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
