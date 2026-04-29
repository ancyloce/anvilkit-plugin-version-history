export { inMemoryAdapter } from "./adapters/in-memory.js";
export type { LocalStorageAdapterOptions } from "./adapters/local-storage.js";
export { localStorageAdapter } from "./adapters/local-storage.js";
export {
	DiffApplyError,
	applyDiff,
	diffIR,
	summarizeDiff,
} from "./diff.js";
export {
	VersionHistoryError,
	type VersionHistoryErrorCode,
} from "./errors.js";
export type { CreateVersionHistoryPluginOptions } from "./plugin.js";
export { createVersionHistoryPlugin } from "./plugin.js";
export type { IRDiff, IRDiffOp, IRDiffSummary } from "./diff.js";
export type {
	MaybePromise,
	PeerInfo,
	PresenceCursor,
	PresenceSelection,
	PresenceState,
	SnapshotAdapter,
	SnapshotAdapterPresence,
	SnapshotMeta,
	Unsubscribe,
} from "./types.js";
