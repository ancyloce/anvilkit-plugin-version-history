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
