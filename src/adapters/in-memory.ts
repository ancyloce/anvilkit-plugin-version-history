import type { PageIR } from "@anvilkit/core/types";
import type {
	SnapshotAdapter,
	SnapshotMeta,
	VersionHistoryExport,
} from "../types/types.js";
import { normalizeVersionHistoryExport } from "../utils/archive.js";
import {
	applyMetaPatch,
	clonePageIR,
	cloneSnapshotMeta,
	createSnapshotMeta,
	createSnapshotNotFoundError,
	deepFreeze,
	freezeSnapshotList,
} from "../utils/internal.js";
import { querySnapshots } from "../utils/query.js";
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

	function deleteOne(id: string): void {
		// Plan re-roots while the base record is still readable, then remove it
		// before writing the (larger) keyframe replacements. In memory there's
		// no quota, but using the same protocol as the localStorage adapter
		// keeps the two implementations behaviorally identical.
		const plans = planReRootedDependents(backend, id);
		recordById.delete(id);
		metaById.delete(id);
		for (const { id: depId, record } of plans) {
			recordById.set(depId, record);
		}
	}

	function importEntry(meta: SnapshotMeta, ir: PageIR): void {
		// Overwriting an id that other deltas chain onto would corrupt their
		// reconstruction, so re-root those dependents to standalone keyframes
		// (capturing their current content) before replacing this record.
		if (metaById.has(meta.id)) {
			const plans = planReRootedDependents(backend, meta.id);
			for (const { id: depId, record } of plans) {
				recordById.set(depId, record);
			}
		}
		recordById.set(meta.id, {
			kind: "full",
			ir: deepFreeze(clonePageIR(ir)),
		});
		// `Map.set` keeps an existing key's insertion position (overwrite) and
		// appends new keys, preserving deterministic save order.
		metaById.set(meta.id, cloneSnapshotMeta(meta));
	}

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
		updateMeta(id, patch) {
			const existing = metaById.get(id);
			if (existing === undefined) {
				throw createSnapshotNotFoundError(id);
			}
			// `Map.set` keeps an existing key's insertion position, so save
			// order is preserved; the delta-chain record is left untouched.
			metaById.set(id, applyMetaPatch(existing, patch));
		},
		query(options) {
			return querySnapshots(
				freezeSnapshotList([...metaById.values()]),
				options,
			);
		},
		load(id) {
			return loadFromChain(backend, id);
		},
		delete(id) {
			deleteOne(id);
		},
		deleteMany(ids) {
			for (const id of ids) {
				deleteOne(id);
			}
		},
		exportAll() {
			const snapshots = [...metaById.values()].map((meta) => ({
				meta: cloneSnapshotMeta(meta),
				ir: clonePageIR(loadFromChain(backend, meta.id)),
			}));
			const archive: VersionHistoryExport = { version: 1, snapshots };
			return archive;
		},
		importAll(data, options) {
			const archive = normalizeVersionHistoryExport(data);
			if ((options?.mode ?? "merge") === "replace") {
				recordById.clear();
				metaById.clear();
			}
			for (const { meta, ir } of archive.snapshots) {
				importEntry(meta, ir);
			}
		},
	};
}
