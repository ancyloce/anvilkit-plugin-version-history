/**
 * @file The snapshot restore path (`p6-005`, PLAN-0026 §4 R5).
 *
 * ## Reading canonical documents
 *
 * This plugin reads **canonical** documents and pre-rewrite ones with
 * the same code, because it reads neither. A snapshot is a `PageIR`
 * whose node and root props are opaque JSON to every function here:
 * nothing in this package branches on `appearance`, `interactions`,
 * `bindings`, `designSystem`, `componentLibrary`, an authoring-schema
 * marker, or any sidecar path. {@link hashPageIR} canonicalizes by
 * key-sorting alone and {@link prepareRestore} returns the stored IR by
 * REFERENCE. That is the tolerant parse: an unrecognised shape is
 * carried through untouched rather than rejected or rewritten.
 *
 * ## The tolerance is time-boxed and closes in `p7-002`
 *
 * A snapshot taken before the canonical rewrite still carries the old
 * shape, and this path deliberately restores it verbatim — **the host,
 * not the plugin, owns migrating it before dispatching to the editor.**
 * That seam is why {@link prepareRestore} is pure and identity-
 * preserving; weakening it to return a rewritten copy would make this
 * plugin a second, undeclared migration site.
 *
 * `p7-002` (final document migration) is what removes the need for the
 * tolerance: once the store holds only canonical documents, "old shape"
 * stops existing and this becomes an ordinary pass-through. Until then
 * the tolerance is a migration window, not a design feature — do not
 * build a version branch here in the meantime, and do not describe this
 * pass-through as permanent.
 */

import type { PageIR } from "@anvilkit/core/types";

import { VersionHistoryError } from "./errors.js";
import { hashPageIR } from "./hash.js";

/**
 * Inputs to {@link checkRestoreConflict}.
 *
 * `expectedBaseHash` is the optimistic-concurrency token: the `PageIR`
 * fingerprint the restore was planned against — typically the live
 * `currentIR` hash captured when the snapshot/diff view was opened, or a
 * persisted `SnapshotMeta.pageIRHash`. Omitting it disables the check
 * (always reports no conflict), which keeps pre-token callers working.
 */
export interface RestoreConflictInput {
	readonly currentIR: PageIR;
	readonly expectedBaseHash?: string;
}

/**
 * Result of comparing the live document hash against an expected base.
 *
 * `currentHash` is the freshly computed `hashPageIR` of `currentIR`;
 * callers can persist it as the next `expectedBaseHash`. `expectedBaseHash`
 * is echoed back only when one was supplied.
 */
export interface RestoreConflict {
	readonly hasConflict: boolean;
	readonly currentHash: string;
	readonly expectedBaseHash?: string;
}

/**
 * Pure optimistic-concurrency check for a rollback. Hashes `currentIR` and
 * compares it to `expectedBaseHash`: a mismatch means the document changed
 * underneath the planned restore (a remote collaborator or a local edit),
 * so blindly applying the snapshot would clobber that work.
 *
 * Has no side effects and never throws — it only reports. Use
 * {@link prepareRestore} when you want a throwing guard instead.
 */
export function checkRestoreConflict(
	input: RestoreConflictInput,
): RestoreConflict {
	const currentHash = hashPageIR(input.currentIR);
	const hasConflict =
		input.expectedBaseHash !== undefined &&
		input.expectedBaseHash !== currentHash;

	return input.expectedBaseHash === undefined
		? { hasConflict, currentHash }
		: { hasConflict, currentHash, expectedBaseHash: input.expectedBaseHash };
}

/**
 * Inputs to {@link prepareRestore}: a {@link RestoreConflictInput} plus the
 * `snapshotIR` to restore and a `force` escape hatch.
 */
export interface PrepareRestoreInput extends RestoreConflictInput {
	readonly snapshotIR: PageIR;
	/** Bypass the conflict check and restore anyway. */
	readonly force?: boolean;
}

/**
 * Conflict-guarded rollback resolver. Runs {@link checkRestoreConflict} and:
 *
 * - returns `snapshotIR` unchanged when there is no conflict (including when
 *   no `expectedBaseHash` was supplied — fully backward compatible), or when
 *   `force` is `true`;
 * - otherwise throws a typed {@link VersionHistoryError} with code
 *   `"CONFLICT"` so the host can prompt the user and retry with `force`.
 *
 * Pure: it resolves *what* to restore but never dispatches — the host owns
 * applying the returned IR to the editor.
 */
export function prepareRestore(input: PrepareRestoreInput): PageIR {
	const result = checkRestoreConflict(input);

	if (result.hasConflict && input.force !== true) {
		throw new VersionHistoryError(
			"CONFLICT",
			`Cannot restore snapshot: the current document has changed since this restore was planned (expected base hash ${input.expectedBaseHash}, current ${result.currentHash}). Pass force to override.`,
		);
	}

	return input.snapshotIR;
}
