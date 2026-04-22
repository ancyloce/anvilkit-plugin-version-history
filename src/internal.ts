import type { PageIR } from "@anvilkit/core/types";

import { VersionHistoryError } from "./errors.js";
import { hashPageIR } from "./hash.js";
import type { SnapshotMeta } from "./types.js";

let fallbackSnapshotId = 0;

export function clonePageIR(ir: PageIR): PageIR {
	if (typeof globalThis.structuredClone === "function") {
		return globalThis.structuredClone(ir);
	}

	return JSON.parse(JSON.stringify(ir)) as PageIR;
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

export function createSnapshotId(): string {
	if (typeof globalThis.crypto?.randomUUID === "function") {
		return globalThis.crypto.randomUUID();
	}

	const id = `snapshot-${String(fallbackSnapshotId).padStart(4, "0")}`;
	fallbackSnapshotId += 1;
	return id;
}

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
