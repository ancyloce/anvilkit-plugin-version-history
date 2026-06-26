import type { PageIR } from "@anvilkit/core/types";

import type {
	SnapshotMeta,
	VersionHistoryExport,
	VersionHistoryExportEntry,
} from "../types/types.js";
import { isIRDiff } from "./diff.js";
import { VersionHistoryError } from "./errors.js";

/** Current {@link VersionHistoryExport.version} the reference adapters emit. */
export const VERSION_HISTORY_EXPORT_VERSION = 1 as const;

function corrupt(message: string): never {
	throw new VersionHistoryError("STORAGE_CORRUPT", message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPageIRShape(value: unknown): value is PageIR {
	return (
		isPlainObject(value) &&
		value.version === "1" &&
		isPlainObject(value.root) &&
		Array.isArray(value.assets) &&
		isPlainObject(value.metadata)
	);
}

function normalizeMeta(value: unknown, where: string): SnapshotMeta {
	if (!isPlainObject(value)) {
		corrupt(`${where} "meta" is not an object.`);
	}

	const { id, savedAt, pageIRHash, label, delta } = value;
	if (typeof id !== "string" || id.length === 0) {
		corrupt(`${where} "meta.id" is missing or not a non-empty string.`);
	}
	if (typeof savedAt !== "string") {
		corrupt(`${where} "meta.savedAt" is not a string.`);
	}
	if (typeof pageIRHash !== "string") {
		corrupt(`${where} "meta.pageIRHash" is not a string.`);
	}
	if (label !== undefined && typeof label !== "string") {
		corrupt(`${where} "meta.label" is not a string.`);
	}
	if (delta !== undefined && !isIRDiff(delta)) {
		corrupt(`${where} "meta.delta" is malformed.`);
	}

	const base = { id, savedAt, pageIRHash } as const;
	const withLabel = label === undefined ? base : { ...base, label };
	return Object.freeze(
		delta === undefined ? withLabel : { ...withLabel, delta },
	);
}

/**
 * Pure validator/normalizer for the {@link VersionHistoryExport} archive shape.
 *
 * The reference adapters call this from `importAll` so a malformed archive is
 * rejected with a typed `STORAGE_CORRUPT` {@link VersionHistoryError} before
 * any mutation, rather than silently storing junk. Exported because it is the
 * canonical, side-effect-free gate for hand-built or third-party archives too.
 *
 * Validates that the envelope is `{ version: 1; snapshots: Entry[] }` and that
 * every entry carries a well-formed `meta` and a `PageIR`-shaped `ir`. The
 * returned archive is frozen and key-canonicalized (extraneous `meta` fields
 * are dropped); entry order is preserved exactly. The `ir` payloads are passed
 * through by reference — callers that persist them clone as needed.
 */
export function normalizeVersionHistoryExport(
	value: unknown,
): VersionHistoryExport {
	if (!isPlainObject(value)) {
		corrupt("Version history export archive is not an object.");
	}
	if (value.version !== VERSION_HISTORY_EXPORT_VERSION) {
		corrupt(
			`Version history export archive has an unsupported version ${JSON.stringify(
				value.version,
			)} (expected ${VERSION_HISTORY_EXPORT_VERSION}).`,
		);
	}
	if (!Array.isArray(value.snapshots)) {
		corrupt('Version history export archive "snapshots" is not an array.');
	}

	const snapshots: VersionHistoryExportEntry[] = value.snapshots.map(
		(entry, index) => {
			const where = `Version history export entry [${index}]`;
			if (!isPlainObject(entry)) {
				corrupt(`${where} is not an object.`);
			}
			if (!isPageIRShape(entry.ir)) {
				corrupt(`${where} "ir" is not a valid PageIR.`);
			}
			return Object.freeze({
				meta: normalizeMeta(entry.meta, where),
				ir: entry.ir,
			});
		},
	);

	const archive: VersionHistoryExport = {
		version: VERSION_HISTORY_EXPORT_VERSION,
		snapshots: Object.freeze(snapshots),
	};
	return Object.freeze(archive);
}
