/**
 * Discriminant carried by every {@link VersionHistoryError}. Callers switch on
 * {@link VersionHistoryError.code} to recover by category instead of
 * string-matching `message`.
 *
 * - `"CONFLICT"` — an optimistic-concurrency check failed: the live document
 *   changed since a restore was planned (see `prepareRestore`). Retry with
 *   `force` to override.
 * - `"PERMISSION_DENIED"` — the host/adapter rejected a `save`/`load`/`list`/
 *   `delete`/`restore` on authorization grounds (the actor is not allowed to
 *   perform it). Surfaces with remote or collaborative adapters; the request
 *   is well-formed but forbidden, so retrying without new credentials will not
 *   help.
 * - `"SNAPSHOT_NOT_FOUND"` — `load`/`delete` referenced an id that does not
 *   exist in the adapter.
 * - `"STORAGE_CORRUPT"` — a persisted payload could not be parsed or decoded.
 * - `"STORAGE_QUOTA_EXCEEDED"` — the backing store rejected a write because it
 *   is full (e.g. the `localStorage` quota).
 * - `"STORAGE_UNAVAILABLE"` — the backing store is missing or inaccessible
 *   (e.g. `localStorage` blocked in a sandboxed or private context).
 */
export type VersionHistoryErrorCode =
	| "CONFLICT"
	| "PERMISSION_DENIED"
	| "SNAPSHOT_NOT_FOUND"
	| "STORAGE_CORRUPT"
	| "STORAGE_QUOTA_EXCEEDED"
	| "STORAGE_UNAVAILABLE";

/**
 * Version-history operations an adapter or host can gate on authorization.
 * Used to describe which action was denied in a `"PERMISSION_DENIED"`
 * {@link VersionHistoryError} (see {@link createPermissionDeniedError}).
 */
export type VersionHistoryOperation =
	| "save"
	| "load"
	| "list"
	| "delete"
	| "restore";

/**
 * Typed error thrown across the version-history surface (adapters, the restore
 * guard, host integrations). The {@link VersionHistoryError.code} discriminant
 * lets callers branch on the failure category instead of parsing `message`.
 */
export class VersionHistoryError extends Error {
	readonly code: VersionHistoryErrorCode;

	constructor(code: VersionHistoryErrorCode, message: string) {
		super(message);
		this.name = "VersionHistoryError";
		this.code = code;
	}
}

/**
 * Convenience constructor for an authorization failure. Host and remote
 * adapters call this when the current actor is not permitted to perform a
 * version-history `operation` (`"save"`, `"load"`, `"list"`, `"delete"`, or
 * `"restore"`), yielding a {@link VersionHistoryError} whose
 * {@link VersionHistoryError.code} is `"PERMISSION_DENIED"` so callers can
 * discriminate it without string-matching the message.
 *
 * Equivalent to `new VersionHistoryError("PERMISSION_DENIED", message)`; the
 * direct constructor remains available for fully custom messages. An optional
 * `detail` is appended to the default message to explain the denial.
 */
export function createPermissionDeniedError(
	operation: VersionHistoryOperation,
	detail?: string,
): VersionHistoryError {
	const suffix = detail === undefined ? "" : ` ${detail}`;
	return new VersionHistoryError(
		"PERMISSION_DENIED",
		`Permission denied: not authorized to ${operation} version history snapshots.${suffix}`,
	);
}
