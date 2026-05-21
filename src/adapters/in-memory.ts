import type { PageIR } from "@anvilkit/core/types";
import type { SnapshotAdapter, SnapshotMeta } from "../types/types.js";
import {
	clonePageIR,
	createSnapshotMeta,
	deepFreeze,
	freezeSnapshotList,
} from "../utils/internal.js";
import {
	buildStoredRecord,
	loadFromChain,
	planReRootedDependents,
	type RecordBackend,
	type StoredRecord,
} from "./snapshot-chain.js";

/**
 * Ephemeral, in-process snapshot store. Uses the shared delta-chain so a
 * long history costs roughly one keyframe + N small diffs instead of N
 * full `PageIR` copies. Suitable for tests, demos, and transient sessions.
 */
export function inMemoryAdapter(): SnapshotAdapter {
	// Insertion order of `metaById` is the canonical save order.
	const metaById = new Map<string, SnapshotMeta>();
	const recordById = new Map<string, StoredRecord>();

	const backend: RecordBackend = {
		read: (id) => recordById.get(id),
		write: (id, record) => {
			recordById.set(id, record);
		},
		remove: (id) => {
			recordById.delete(id);
		},
		orderedIds: () => [...metaById.keys()],
	};

	return {
		save(ir, meta) {
			// Single clone at the trust boundary; everything downstream is
			// frozen and reused without re-cloning.
			const storedIR = deepFreeze(clonePageIR(ir));
			const snapshotMeta = createSnapshotMeta(storedIR, meta);
			const record = buildStoredRecord(backend, storedIR);
			recordById.set(snapshotMeta.id, record);
			metaById.set(snapshotMeta.id, snapshotMeta);
			return snapshotMeta.id;
		},
		list() {
			return freezeSnapshotList([...metaById.values()]);
		},
		load(id) {
			return loadFromChain(backend, id);
		},
		delete(id) {
			// Plan re-roots while the base record is still readable, then
			// remove it before writing the (larger) keyframe replacements.
			// In memory there's no quota, but using the same protocol as
			// the localStorage adapter keeps the two implementations
			// behaviorally identical and easier to reason about.
			const plans = planReRootedDependents(backend, id);
			recordById.delete(id);
			metaById.delete(id);
			for (const { id: depId, record } of plans) {
				recordById.set(depId, record);
			}
		},
	};
}
