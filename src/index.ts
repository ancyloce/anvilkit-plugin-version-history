export { inMemoryAdapter } from "./adapters/in-memory.js";
export type { LocalStorageAdapterOptions } from "./adapters/local-storage.js";
export { localStorageAdapter } from "./adapters/local-storage.js";
export type { CreateVersionHistoryPluginOptions } from "./plugin.js";
export { createVersionHistoryPlugin } from "./plugin.js";
export type {
	BuildPageIR,
	MaybePromise,
	PeerInfo,
	PresenceCursor,
	PresenceSelection,
	PresenceState,
	SnapshotAdapter,
	SnapshotAdapterPresence,
	SnapshotMeta,
	SnapshotMetaPatch,
	SnapshotPage,
	SnapshotQuery,
	Unsubscribe,
	VersionHistoryExport,
	VersionHistoryExportEntry,
	VersionHistoryImportOptions,
} from "./types/types.js";
export { normalizeVersionHistoryExport } from "./utils/archive.js";
export type { IRDiff, IRDiffOp, IRDiffSummary } from "./utils/diff.js";
export {
	applyDiff,
	DiffApplyError,
	diffIR,
	isIRDiff,
	summarizeDiff,
} from "./utils/diff.js";
export {
	createPermissionDeniedError,
	VersionHistoryError,
	type VersionHistoryErrorCode,
	type VersionHistoryOperation,
} from "./utils/errors.js";
export { querySnapshots } from "./utils/query.js";
export {
	checkRestoreConflict,
	type PrepareRestoreInput,
	prepareRestore,
	type RestoreConflict,
	type RestoreConflictInput,
} from "./utils/restore.js";
export {
	planRetention,
	type RetentionAdapter,
	type RetentionPlan,
	type RetentionPlanOptions,
	type RetentionPolicy,
	type RetentionResult,
	type RunRetentionOptions,
	runRetention,
} from "./utils/retention.js";
