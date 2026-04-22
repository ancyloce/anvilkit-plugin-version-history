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

			storage.setItem(
				recordKey(options.namespace, snapshotMeta.id),
				serializeRecord(storedIR),
			);
			storage.setItem(indexKey, JSON.stringify([...snapshots, snapshotMeta]));

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
			storage.setItem(indexKey, JSON.stringify(snapshots));
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

	try {
		return JSON.parse(raw) as SnapshotMeta[];
	} catch (error) {
		throw new VersionHistoryError(
			"STORAGE_CORRUPT",
			`Version history index at "${key}" is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function serializeRecord(ir: PageIR): string {
	return JSON.stringify(ir);
}

function parseRecord(raw: string): PageIR {
	try {
		return JSON.parse(raw) as PageIR;
	} catch (error) {
		throw new VersionHistoryError(
			"STORAGE_CORRUPT",
			`Version history snapshot payload is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
