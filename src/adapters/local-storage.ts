import type { PageIR } from "@anvilkit/core/types";

import { VersionHistoryError } from "../errors.js";
import {
	clonePageIR,
	createSnapshotMeta,
	createSnapshotNotFoundError,
	deepFreeze,
	freezeSnapshotList,
} from "../internal.js";
import type { SnapshotAdapter, SnapshotMeta } from "../types.js";

export interface LocalStorageAdapterOptions {
	readonly namespace: string;
}

export function localStorageAdapter(
	options: LocalStorageAdapterOptions,
): SnapshotAdapter {
	const indexKey = `${options.namespace}:snapshots:index`;

	return {
		save(ir, meta) {
			const storage = getStorage();
			const storedIR = deepFreeze(clonePageIR(ir));
			const snapshotMeta = createSnapshotMeta(storedIR, meta);
			const snapshots = readIndex(storage, indexKey);
			const recordKeyForId = recordKey(options.namespace, snapshotMeta.id);

			let recordWritten = false;
			try {
				setItemOrThrow(storage, recordKeyForId, serializeRecord(storedIR));
				recordWritten = true;
				setItemOrThrow(
					storage,
					indexKey,
					JSON.stringify([...snapshots, snapshotMeta]),
				);
			} catch (error) {
				if (recordWritten) {
					try {
						storage.removeItem(recordKeyForId);
					} catch {
						/* swallow rollback errors — the original throw is more useful */
					}
				}
				throw error;
			}

			return snapshotMeta.id;
		},
		list() {
			const storage = getStorage();
			return freezeSnapshotList(readIndex(storage, indexKey));
		},
		load(id) {
			const storage = getStorage();
			const raw = storage.getItem(recordKey(options.namespace, id));

			if (raw === null) {
				throw createSnapshotNotFoundError(id);
			}

			return deepFreeze(parseRecord(raw));
		},
		delete(id) {
			const storage = getStorage();
			const snapshots = readIndex(storage, indexKey).filter(
				(snapshot) => snapshot.id !== id,
			);

			storage.removeItem(recordKey(options.namespace, id));
			setItemOrThrow(storage, indexKey, JSON.stringify(snapshots));
		},
	};
}

function getStorage(): Storage {
	if (typeof globalThis.localStorage === "undefined") {
		throw new VersionHistoryError(
			"STORAGE_UNAVAILABLE",
			"globalThis.localStorage is unavailable in this environment.",
		);
	}

	return globalThis.localStorage;
}

function recordKey(namespace: string, id: string): string {
	return `${namespace}:snapshots:${id}`;
}

function readIndex(storage: Storage, key: string): SnapshotMeta[] {
	const raw = storage.getItem(key);
	if (raw === null) {
		return [];
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new VersionHistoryError(
			"STORAGE_CORRUPT",
			`Version history index at "${key}" is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	if (!Array.isArray(parsed)) {
		throw new VersionHistoryError(
			"STORAGE_CORRUPT",
			`Version history index at "${key}" is not an array.`,
		);
	}

	return parsed.map((entry, index) => assertSnapshotMeta(entry, key, index));
}

function serializeRecord(ir: PageIR): string {
	return JSON.stringify(ir);
}

function parseRecord(raw: string): PageIR {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new VersionHistoryError(
			"STORAGE_CORRUPT",
			`Version history snapshot payload is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	return assertPageIR(parsed);
}

function assertSnapshotMeta(
	value: unknown,
	indexKeyForError: string,
	entryIndex: number,
): SnapshotMeta {
	if (!isPlainObject(value)) {
		throw new VersionHistoryError(
			"STORAGE_CORRUPT",
			`Version history index entry at "${indexKeyForError}[${entryIndex}]" is not an object.`,
		);
	}

	const { id, savedAt, pageIRHash, label } = value;
	if (typeof id !== "string" || id.length === 0) {
		throw new VersionHistoryError(
			"STORAGE_CORRUPT",
			`Version history index entry at "${indexKeyForError}[${entryIndex}]" is missing a string "id".`,
		);
	}
	if (typeof savedAt !== "string") {
		throw new VersionHistoryError(
			"STORAGE_CORRUPT",
			`Version history index entry "${id}" is missing a string "savedAt".`,
		);
	}
	if (typeof pageIRHash !== "string") {
		throw new VersionHistoryError(
			"STORAGE_CORRUPT",
			`Version history index entry "${id}" is missing a string "pageIRHash".`,
		);
	}
	if (label !== undefined && typeof label !== "string") {
		throw new VersionHistoryError(
			"STORAGE_CORRUPT",
			`Version history index entry "${id}" has a non-string "label".`,
		);
	}

	return label === undefined
		? { id, savedAt, pageIRHash }
		: { id, label, savedAt, pageIRHash };
}

function assertPageIR(value: unknown): PageIR {
	if (!isPlainObject(value)) {
		throw new VersionHistoryError(
			"STORAGE_CORRUPT",
			"Version history snapshot payload is not an object.",
		);
	}
	if (value.version !== "1") {
		throw new VersionHistoryError(
			"STORAGE_CORRUPT",
			`Version history snapshot payload has unsupported version: ${JSON.stringify(value.version)}`,
		);
	}
	if (!isPlainObject(value.root)) {
		throw new VersionHistoryError(
			"STORAGE_CORRUPT",
			"Version history snapshot payload is missing a root node object.",
		);
	}
	if (!Array.isArray(value.assets)) {
		throw new VersionHistoryError(
			"STORAGE_CORRUPT",
			"Version history snapshot payload is missing an assets array.",
		);
	}
	if (!isPlainObject(value.metadata)) {
		throw new VersionHistoryError(
			"STORAGE_CORRUPT",
			"Version history snapshot payload is missing a metadata object.",
		);
	}

	return value as unknown as PageIR;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function setItemOrThrow(storage: Storage, key: string, value: string): void {
	try {
		storage.setItem(key, value);
	} catch (error) {
		if (isQuotaExceededError(error)) {
			throw new VersionHistoryError(
				"STORAGE_QUOTA_EXCEEDED",
				`Version history could not write "${key}" — localStorage quota exceeded. Evict older snapshots and retry.`,
			);
		}
		throw error;
	}
}

function isQuotaExceededError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	if (error.name === "QuotaExceededError") {
		return true;
	}
	// Firefox legacy name.
	if (error.name === "NS_ERROR_DOM_QUOTA_REACHED") {
		return true;
	}
	// Safari legacy DOMException code 22.
	const code = (error as { code?: number }).code;
	return code === 22 || code === 1014;
}
