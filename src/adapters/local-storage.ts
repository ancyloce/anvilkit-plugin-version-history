import type { IRDiff } from "../utils/diff.js";
import { VersionHistoryError } from "../utils/errors.js";
import {
  clonePageIR,
  createSnapshotMeta,
  deepFreeze,
  freezeSnapshotList,
} from "../utils/internal.js";
import type { SnapshotAdapter, SnapshotMeta } from "../types/types.js";
import {
  type RecordBackend,
  type StoredRecord,
  buildStoredRecord,
  loadFromChain,
  normalizeStoredRecord,
  planReRootedDependents,
} from "./snapshot-chain.js";

export interface LocalStorageAdapterOptions {
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

  const { id, savedAt, pageIRHash, label, delta } = value;
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
  if (delta !== undefined && !Array.isArray(delta)) {
    throw new VersionHistoryError(
      "STORAGE_CORRUPT",
      `Version history index entry "${id}" has a non-array "delta".`,
    );
  }

  const base = { id, savedAt, pageIRHash } as const;
  const withLabel = label === undefined ? base : { ...base, label };
  return delta === undefined
    ? withLabel
    : { ...withLabel, delta: delta as IRDiff };
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
