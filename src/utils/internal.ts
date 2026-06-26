import type { PageIR } from "@anvilkit/core/types";
import type { SnapshotMeta, SnapshotMetaPatch } from "../types/types.js";
import { VersionHistoryError } from "./errors.js";
import { hashPageIR } from "./hash.js";

/**
 * The mutable, host-curated metadata fields — every {@link SnapshotMeta} field
 * except the identity/provenance `id`/`savedAt`/`pageIRHash`/`delta`. Kept in
 * one place so snapshot construction, cloning, and `updateMeta` all agree on
 * which fields are user-editable (and which survive a round-trip).
 */
const MUTABLE_META_KEYS = [
	"label",
	"tags",
	"milestone",
	"protected",
	"author",
	"notes",
] as const;

/** Copy each present (non-`undefined`) mutable meta field from `source` onto `target`. */
function copyPresentMutableMeta(
	source: Partial<SnapshotMeta> | SnapshotMetaPatch,
	target: Record<string, unknown>,
): void {
	for (const key of MUTABLE_META_KEYS) {
		const value = (source as Record<string, unknown>)[key];
		if (value !== undefined) {
			target[key] = value;
		}
	}
}

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
	const result: Record<string, unknown> = { id: createSnapshotId() };
	copyPresentMutableMeta(meta, result);
	result.savedAt = new Date().toISOString();
	result.pageIRHash = meta.pageIRHash ?? hashPageIR(ir);
	if (meta.delta !== undefined) {
		result.delta = meta.delta;
	}
	return Object.freeze(result) as unknown as SnapshotMeta;
}

export function cloneSnapshotMeta(meta: SnapshotMeta): SnapshotMeta {
	const result: Record<string, unknown> = { id: meta.id };
	copyPresentMutableMeta(meta, result);
	result.savedAt = meta.savedAt;
	result.pageIRHash = meta.pageIRHash;
	if (meta.delta !== undefined) {
		result.delta = meta.delta;
	}
	return Object.freeze(result) as unknown as SnapshotMeta;
}

/**
 * Produce a new frozen {@link SnapshotMeta} with the mutable fields of `patch`
 * applied over `existing`. Identity/provenance fields (`id`/`savedAt`/
 * `pageIRHash`/`delta`) are always carried from `existing`; only present patch
 * fields override their counterparts, so omitted fields are left unchanged.
 * Shared by every adapter's `updateMeta` so the merge rule stays consistent.
 */
export function applyMetaPatch(
	existing: SnapshotMeta,
	patch: SnapshotMetaPatch,
): SnapshotMeta {
	const result: Record<string, unknown> = { id: existing.id };
	copyPresentMutableMeta(existing, result);
	copyPresentMutableMeta(patch, result);
	result.savedAt = existing.savedAt;
	result.pageIRHash = existing.pageIRHash;
	if (existing.delta !== undefined) {
		result.delta = existing.delta;
	}
	return Object.freeze(result) as unknown as SnapshotMeta;
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
