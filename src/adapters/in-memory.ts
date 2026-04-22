import type { PageIR } from "@anvilkit/core/types";

import {
	clonePageIR,
	cloneSnapshotMeta,
	createSnapshotMeta,
	createSnapshotNotFoundError,
	deepFreeze,
	freezeSnapshotList,
} from "../internal.js";
import type { SnapshotAdapter } from "../types.js";

interface SnapshotRecord {
	readonly ir: PageIR;
	readonly meta: ReturnType<typeof createSnapshotMeta>;
}

export function inMemoryAdapter(): SnapshotAdapter {
	const records = new Map<string, SnapshotRecord>();

	return {
		save(ir, meta) {
			const storedIR = deepFreeze(clonePageIR(ir));
			const snapshotMeta = createSnapshotMeta(storedIR, meta);
			records.set(snapshotMeta.id, {
				ir: storedIR,
				meta: snapshotMeta,
			});
			return snapshotMeta.id;
		},
		list() {
			return freezeSnapshotList(
				Array.from(records.values(), (record) => cloneSnapshotMeta(record.meta)),
			);
		},
		load(id) {
			const record = records.get(id);
			if (!record) {
				throw createSnapshotNotFoundError(id);
			}

			return deepFreeze(clonePageIR(record.ir));
		},
		delete(id) {
			records.delete(id);
		},
	};
}
