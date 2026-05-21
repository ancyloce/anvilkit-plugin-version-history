export type VersionHistoryErrorCode =
	| "SNAPSHOT_NOT_FOUND"
	| "STORAGE_CORRUPT"
	| "STORAGE_QUOTA_EXCEEDED"
	| "STORAGE_UNAVAILABLE";

export class VersionHistoryError extends Error {
	readonly code: VersionHistoryErrorCode;

	constructor(code: VersionHistoryErrorCode, message: string) {
		super(message);
		this.name = "VersionHistoryError";
		this.code = code;
	}
}
