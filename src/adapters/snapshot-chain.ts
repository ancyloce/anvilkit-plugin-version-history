import type { PageIR } from "@anvilkit/core/types";

import { type IRDiff, applyDiff, diffIR } from "../diff.js";
import { VersionHistoryError } from "../errors.js";
import { clonePageIR, deepFreeze } from "../internal.js";

/**
 * Differential snapshot storage ("delta-chain").
 *
 * Instead of persisting a full `PageIR` per version, every
 * {@link KEYFRAME_INTERVAL}-th snapshot is stored whole (a *keyframe*) and
 * the snapshots in between are stored as the structural diff from the
 * immediately previous snapshot. `load` walks the `base` pointers back to
 * the nearest keyframe and replays the diffs forward with {@link applyDiff}.
 *
 * `diffIR`/`applyDiff` only model the node tree — top-level `assets` and
 * `metadata` are *not* diffed — so a delta record additionally stores the
 * snapshot's own `assets`/`metadata` verbatim. Reconstruction is therefore
 * byte-for-byte lossless: `load(save(ir)) deep-equals ir`.
 *
 * Back-compat: snapshots written by older versions are raw `PageIR` JSON;
 * {@link normalizeStoredRecord} reads them transparently as keyframes.
 */
export const KEYFRAME_INTERVAL = 20;

export type StoredRecord =
  | { readonly kind: "full"; readonly ir: PageIR }
  | {
      readonly kind: "delta";
      readonly base: string;
      readonly diff: IRDiff;
      readonly assets: PageIR["assets"];
      readonly metadata: PageIR["metadata"];
    };

/**
 * Low-level per-record persistence the chain logic is layered on. `read`
 * returns `undefined` for an unknown id; `orderedIds` lists every stored
 * snapshot id in save order (used for keyframe spacing + delete re-root).
 */
export interface RecordBackend {
  read(id: string): StoredRecord | undefined;
  write(id: string, record: StoredRecord): void;
  remove(id: string): void;
  orderedIds(): readonly string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Structural deep-equality used as the delta-losslessness gate.
 *
 * `diffIR(a, b).length === 0` is *not* a sound equality check — `diffIR`
 * intentionally ignores parts of `PageIR` (notably top-level
 * `assets`/`metadata`) and a few node-level shapes, so it can return
 * empty when the candidate has actually lost information. This function
 * walks both values structurally and is authoritative; the gate uses it
 * before accepting a delta record.
 */
function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== typeof right) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (
      !Array.isArray(left) ||
      !Array.isArray(right) ||
      left.length !== right.length
    ) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!structurallyEqual(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  if (leftKeys.length !== Object.keys(rightRecord).length) {
    return false;
  }
  for (const key of leftKeys) {
    if (!Object.hasOwn(rightRecord, key)) {
      return false;
    }
    if (!structurallyEqual(leftRecord[key], rightRecord[key])) {
      return false;
    }
  }
  return true;
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

/** Parse a stored payload, transparently upgrading legacy raw-`PageIR` records. */
export function normalizeStoredRecord(parsed: unknown): StoredRecord {
  if (isPlainObject(parsed) && parsed.kind === "full") {
    if (!isPageIRShape(parsed.ir)) {
      throw new VersionHistoryError(
        "STORAGE_CORRUPT",
        "Version history keyframe record is missing a valid PageIR.",
      );
    }
    return { kind: "full", ir: parsed.ir };
  }

  if (isPlainObject(parsed) && parsed.kind === "delta") {
    if (typeof parsed.base !== "string" || parsed.base.length === 0) {
      throw new VersionHistoryError(
        "STORAGE_CORRUPT",
        "Version history delta record is missing a base id.",
      );
    }
    if (
      !Array.isArray(parsed.diff) ||
      !Array.isArray(parsed.assets) ||
      !isPlainObject(parsed.metadata)
    ) {
      throw new VersionHistoryError(
        "STORAGE_CORRUPT",
        "Version history delta record is malformed.",
      );
    }
    return {
      kind: "delta",
      base: parsed.base,
      diff: parsed.diff as IRDiff,
      assets: parsed.assets as PageIR["assets"],
      metadata: parsed.metadata as PageIR["metadata"],
    };
  }

  // Legacy: snapshots written before delta-chain are raw PageIR JSON.
  if (isPageIRShape(parsed)) {
    return { kind: "full", ir: parsed };
  }

  throw new VersionHistoryError(
    "STORAGE_CORRUPT",
    "Version history snapshot payload has an unrecognized shape.",
  );
}

function reconstruct(
  backend: RecordBackend,
  id: string,
  seen: Set<string>,
): PageIR {
  if (seen.has(id)) {
    throw new VersionHistoryError(
      "STORAGE_CORRUPT",
      `Version history snapshot chain contains a cycle at "${id}".`,
    );
  }
  seen.add(id);

  const record = backend.read(id);
  if (!record) {
    throw new VersionHistoryError(
      "STORAGE_CORRUPT",
      `Version history snapshot chain references a missing record "${id}".`,
    );
  }

  if (record.kind === "full") {
    return record.ir;
  }

  const baseIR = reconstruct(backend, record.base, seen);
  const applied = applyDiff(baseIR, record.diff);
  return deepFreeze({
    version: "1",
    root: applied.root,
    assets: record.assets,
    metadata: record.metadata,
  }) as PageIR;
}

/** Decide and build the record for a new snapshot of `clonedIR`. */
export function buildStoredRecord(
  backend: RecordBackend,
  clonedIR: PageIR,
): StoredRecord {
  const ids = backend.orderedIds();
  const previousId = ids.at(-1);

  if (previousId === undefined || ids.length % KEYFRAME_INTERVAL === 0) {
    return { kind: "full", ir: clonedIR };
  }

  // Diff against what `load(previousId)` reconstructs to, so this delta's
  // base is exactly the IR a future `load` will replay onto.
  const previousIR = reconstruct(backend, previousId, new Set());

  // `diffIR`/`applyDiff` model only the node tree and are not total
  // (e.g. a changed root id, or other unrepresentable edits). Keep a
  // delta only when it provably round-trips; otherwise fall back to a
  // full keyframe so storage is always lossless.
  try {
    const diff = diffIR(previousIR, clonedIR);
    const applied = applyDiff(previousIR, diff);
    const candidate = {
      version: "1",
      root: applied.root,
      assets: clonedIR.assets,
      metadata: clonedIR.metadata,
    } as PageIR;

    if (structurallyEqual(candidate, clonedIR)) {
      return {
        kind: "delta",
        base: previousId,
        diff,
        assets: clonedIR.assets,
        metadata: clonedIR.metadata,
      };
    }
  } catch {
    /* unrepresentable edit — fall through to a full keyframe */
  }

  return { kind: "full", ir: clonedIR };
}

/** Reconstruct the full `PageIR` for `id`, or throw if it does not exist. */
export function loadFromChain(backend: RecordBackend, id: string): PageIR {
  if (!backend.read(id)) {
    throw new VersionHistoryError(
      "SNAPSHOT_NOT_FOUND",
      `Snapshot "${id}" was not found.`,
    );
  }
  return reconstruct(backend, id, new Set());
}

/**
 * Plan the keyframe-promotions required before deleting `id`, without
 * mutating the backend. The adapter calls this BEFORE removing the
 * target record, then applies the plans afterward — that ordering frees
 * the target's bytes first, which matters for the `localStorage` adapter
 * under quota pressure (promoting a delta to a full keyframe is strictly
 * larger, so writing replacements before freeing the base could throw
 * `STORAGE_QUOTA_EXCEEDED` exactly when eviction is needed).
 *
 * Reconstruction reads the base record, so this function must run while
 * the target record is still present.
 */
export function planReRootedDependents(
  backend: RecordBackend,
  id: string,
): ReadonlyArray<{ readonly id: string; readonly record: StoredRecord }> {
  const plans: { id: string; record: StoredRecord }[] = [];
  for (const candidateId of backend.orderedIds()) {
    if (candidateId === id) {
      continue;
    }

    const record = backend.read(candidateId);
    if (record?.kind === "delta" && record.base === id) {
      const full = reconstruct(backend, candidateId, new Set());
      plans.push({ id: candidateId, record: { kind: "full", ir: full } });
    }
  }
  return plans;
}

export { clonePageIR, deepFreeze };
