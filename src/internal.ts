import type { PageIR } from "@anvilkit/core/types";

import { VersionHistoryError } from "./errors.js";
import { hashPageIR } from "./hash.js";
import type { SnapshotMeta } from "./types.js";

export function clonePageIR(ir: PageIR): PageIR {
	return globalThis.structuredClone(ir);
}

export function deepFreeze<T>(value: T): T {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
		return value;
	}

	for (const property of Object.values(value as Record<string, unknown>)) {
		deepFreeze(property);
	}

	return Object.freeze(value);
}

const createSnapshotId = (() => {
	let counter = 0;
	return (): string => {
		if (typeof globalThis.crypto?.randomUUID === "function") {
			return globalThis.crypto.randomUUID();
		}

		const id = `snapshot-${String(counter).padStart(4, "0")}`;
		counter += 1;
		return id;
	};
})();

export { createSnapshotId };

export function createSnapshotMeta(
	ir: PageIR,
	meta: Partial<Omit<SnapshotMeta, "id" | "savedAt">>,
): SnapshotMeta {
	return Object.freeze({
		id: createSnapshotId(),
		...(meta.label !== undefined ? { label: meta.label } : {}),
		savedAt: new Date().toISOString(),
		pageIRHash: meta.pageIRHash ?? hashPageIR(ir),
	});
}

export function cloneSnapshotMeta(meta: SnapshotMeta): SnapshotMeta {
	return Object.freeze({
		id: meta.id,
		...(meta.label !== undefined ? { label: meta.label } : {}),
		savedAt: meta.savedAt,
		pageIRHash: meta.pageIRHash,
	});
}

export function freezeSnapshotList(
	metas: readonly SnapshotMeta[],
): readonly SnapshotMeta[] {
	return Object.freeze(metas.map((meta) => cloneSnapshotMeta(meta)));
}

export function createSnapshotNotFoundError(id: string): VersionHistoryError {
	return new VersionHistoryError(
		"SNAPSHOT_NOT_FOUND",
		`Snapshot "${id}" was not found.`,
	);
}
