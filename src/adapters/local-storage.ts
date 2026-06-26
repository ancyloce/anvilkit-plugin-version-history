import type {
	SnapshotAdapter,
	SnapshotMeta,
	VersionHistoryExport,
} from "../types/types.js";
import { normalizeVersionHistoryExport } from "../utils/archive.js";
import { isIRDiff } from "../utils/diff.js";
import { VersionHistoryError } from "../utils/errors.js";
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
	normalizeStoredRecord,
	planReRootedDependents,
	type RecordBackend,
	type StoredRecord,
} from "./snapshot-chain.js";

export interface LocalStorageAdapterOptions {
	/**
	 * Key prefix isolating this adapter's data within a single `localStorage`
	 * origin. Every key is derived from it verbatim — `` `${namespace}:snapshots:index` ``
	 * for the index and `` `${namespace}:snapshots:${id}` `` for each record — so
	 * the namespace is what keeps one host's (or document's) history from
	 * colliding with another's that shares the same origin.
	 *
	 * Must be a non-empty string once surrounding whitespace is trimmed. An
	 * empty or whitespace-only value would yield malformed, prefix-less keys
	 * (e.g. `":snapshots:index"`) that silently collide across hosts, so
	 * {@link localStorageAdapter} throws a `TypeError` at construction rather
	 * than corrupt data later. The value is validated but **not** trimmed
	 * for key derivation: a namespace with surrounding whitespace is accepted and
	 * used exactly as given, so callers should pass a stable, whitespace-free
	 * prefix per host.
	 */
	readonly namespace: string;
}

/**
 * Browser `localStorage`-backed snapshot store.
 *
 * Records use the shared delta-chain format (keyframe + diffs) so a long
 * history fits the ~5–10 MB quota far better than one full `PageIR` per
 * version. Records written by older versions are raw `PageIR` JSON and are
 * read transparently as keyframes — no migration required. The snapshot
 * **index** schema is unchanged.
 */
export function localStorageAdapter(
	options: LocalStorageAdapterOptions,
): SnapshotAdapter {
	assertValidNamespace(options.namespace);
	const indexKey = `${options.namespace}:snapshots:index`;

	const backend: RecordBackend = {
		read(id) {
			const storage = getStorage();
			const raw = storage.getItem(recordKey(options.namespace, id));
			if (raw === null) {
				return undefined;
			}

			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch (error) {
				throw new VersionHistoryError(
					"STORAGE_CORRUPT",
					`Version history snapshot payload is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
				);
			}

			return normalizeStoredRecord(parsed);
		},
		write(id, record) {
			const storage = getStorage();
			setItemOrThrow(
				storage,
				recordKey(options.namespace, id),
				JSON.stringify(record),
			);
		},
		remove(id) {
			const storage = getStorage();
			storage.removeItem(recordKey(options.namespace, id));
		},
		orderedIds() {
			const storage = getStorage();
			return readIndex(storage, indexKey).map((snapshot) => snapshot.id);
		},
	};

	return {
		save(ir, meta) {
			const storage = getStorage();
			// Single clone at the trust boundary.
			const storedIR = deepFreeze(clonePageIR(ir));
			const snapshotMeta = createSnapshotMeta(storedIR, meta);
			const snapshots = readIndex(storage, indexKey);
			const recordKeyForId = recordKey(options.namespace, snapshotMeta.id);
			const record: StoredRecord = buildStoredRecord(backend, storedIR);

			let recordWritten = false;
			try {
				setItemOrThrow(storage, recordKeyForId, JSON.stringify(record));
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
		updateMeta(id, patch) {
			const storage = getStorage();
			const snapshots = readIndex(storage, indexKey);
			const target = snapshots.find((meta) => meta.id === id);
			if (target === undefined) {
				throw createSnapshotNotFoundError(id);
			}
			// Patch only the index entry; the snapshot's record (IR/delta chain)
			// is a separate key and stays untouched.
			const next = snapshots.map((meta) =>
				meta.id === id ? applyMetaPatch(meta, patch) : meta,
			);
			setItemOrThrow(storage, indexKey, JSON.stringify(next));
		},
		query(options) {
			const storage = getStorage();
			return querySnapshots(
				freezeSnapshotList(readIndex(storage, indexKey)),
				options,
			);
		},
		load(id) {
			return loadFromChain(backend, id);
		},
		delete(id) {
			const storage = getStorage();
			const targetRecordKey = recordKey(options.namespace, id);

			// Snapshot the target record's raw payload so we can restore
			// it if quota-pressure aborts the eviction mid-way.
			const targetRaw = storage.getItem(targetRecordKey);

			// Plan keyframe-promotions in memory while the base is still
			// readable from storage.
			const plans = planReRootedDependents(backend, id);

			// Free the target's bytes BEFORE writing the (strictly larger)
			// keyframe replacements — see `planReRootedDependents` for why.
			storage.removeItem(targetRecordKey);

			try {
				for (const { id: depId, record } of plans) {
					backend.write(depId, record);
				}
				const snapshots = readIndex(storage, indexKey).filter(
					(snapshot) => snapshot.id !== id,
				);
				setItemOrThrow(storage, indexKey, JSON.stringify(snapshots));
			} catch (error) {
				// Restore the target so any dependents whose promotion did
				// not land can still reconstruct via the original chain.
				if (targetRaw !== null) {
					try {
						storage.setItem(targetRecordKey, targetRaw);
					} catch {
						/* rollback best-effort — re-throw the original */
					}
				}
				throw error;
			}
		},
		deleteMany(ids) {
			if (ids.length === 0) {
				return;
			}
			const storage = getStorage();
			const toDelete = new Set(ids);

			// Free each target's bytes (after re-rooting its dependents) BEFORE
			// the single index write at the end — mirroring `delete`'s ordering
			// so eviction never trips the quota.
			for (const id of toDelete) {
				const targetRecordKey = recordKey(options.namespace, id);
				const targetRaw = storage.getItem(targetRecordKey);
				if (targetRaw === null) {
					// Unknown id — nothing to free or re-root.
					continue;
				}

				const plans = planReRootedDependents(backend, id);
				storage.removeItem(targetRecordKey);
				try {
					for (const { id: depId, record } of plans) {
						backend.write(depId, record);
					}
				} catch (error) {
					try {
						storage.setItem(targetRecordKey, targetRaw);
					} catch {
						/* rollback best-effort — re-throw the original */
					}
					throw error;
				}
			}

			const snapshots = readIndex(storage, indexKey).filter(
				(snapshot) => !toDelete.has(snapshot.id),
			);
			setItemOrThrow(storage, indexKey, JSON.stringify(snapshots));
		},
		exportAll() {
			const storage = getStorage();
			const snapshots = readIndex(storage, indexKey).map((meta) => ({
				meta: cloneSnapshotMeta(meta),
				ir: loadFromChain(backend, meta.id),
			}));
			const archive: VersionHistoryExport = { version: 1, snapshots };
			return archive;
		},
		importAll(data, importOptions) {
			const archive = normalizeVersionHistoryExport(data);
			const storage = getStorage();
			const mode = importOptions?.mode ?? "merge";

			if (mode === "replace") {
				for (const meta of readIndex(storage, indexKey)) {
					backend.remove(meta.id);
				}
				const metas: SnapshotMeta[] = [];
				for (const { meta, ir } of archive.snapshots) {
					// `backend.write` JSON-serializes, detaching the archive's `ir`.
					backend.write(meta.id, { kind: "full", ir });
					metas.push(cloneSnapshotMeta(meta));
				}
				setItemOrThrow(storage, indexKey, JSON.stringify(metas));
				return;
			}

			// Merge: add/overwrite by id, preserving existing order for
			// overwrites and appending new ids.
			const indexById = new Map<string, SnapshotMeta>(
				readIndex(storage, indexKey).map((meta) => [meta.id, meta]),
			);
			for (const { meta, ir } of archive.snapshots) {
				if (indexById.has(meta.id)) {
					// Re-root existing deltas that chain onto this id before its
					// record is overwritten, so they stay loadable.
					const plans = planReRootedDependents(backend, meta.id);
					for (const { id: depId, record } of plans) {
						backend.write(depId, record);
					}
				}
				backend.write(meta.id, { kind: "full", ir });
				indexById.set(meta.id, cloneSnapshotMeta(meta));
			}
			setItemOrThrow(
				storage,
				indexKey,
				JSON.stringify([...indexById.values()]),
			);
		},
	};
}

/**
 * Guard `namespace` at construction so a bad value fails loudly here instead of
 * silently producing colliding, prefix-less keys on the first write. This is a
 * caller misconfiguration (an invalid argument), not a recoverable storage
 * condition, so it throws a {@link TypeError} rather than a typed
 * `VersionHistoryError` — consumers should fix the call, not catch and branch.
 */
function assertValidNamespace(namespace: string): void {
	if (typeof namespace !== "string" || namespace.trim().length === 0) {
		throw new TypeError(
			`localStorageAdapter requires a non-empty "namespace" (received ${JSON.stringify(
				namespace,
			)}). It prefixes every storage key (\`<namespace>:snapshots:*\`); an empty or whitespace-only value would produce malformed keys that collide across hosts.`,
		);
	}
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

	const { id, savedAt, pageIRHash } = value;
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

	const corrupt = (detail: string): never => {
		throw new VersionHistoryError(
			"STORAGE_CORRUPT",
			`Version history index entry "${id}" ${detail}.`,
		);
	};

	// Reconstruct the entry, carrying only the optional fields that are present
	// and well-typed. Records written before tags/milestone/protected/author/
	// notes existed simply omit them — they are never required.
	const result: Record<string, unknown> = { id, savedAt, pageIRHash };
	for (const key of ["label", "author", "notes"] as const) {
		const field = value[key];
		if (field !== undefined) {
			if (typeof field !== "string") {
				corrupt(`has a non-string "${key}"`);
			}
			result[key] = field;
		}
	}
	for (const key of ["milestone", "protected"] as const) {
		const field = value[key];
		if (field !== undefined) {
			if (typeof field !== "boolean") {
				corrupt(`has a non-boolean "${key}"`);
			}
			result[key] = field;
		}
	}
	const { tags, delta } = value;
	if (tags !== undefined) {
		if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
			corrupt('has a non-string-array "tags"');
		}
		result.tags = tags;
	}
	if (delta !== undefined) {
		if (!isIRDiff(delta)) {
			corrupt('has a malformed "delta"');
		}
		result.delta = delta;
	}

	return result as unknown as SnapshotMeta;
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
