export { inMemoryAdapter } from "./adapters/in-memory.js";
export type { LocalStorageAdapterOptions } from "./adapters/local-storage.js";
export { localStorageAdapter } from "./adapters/local-storage.js";
export { DiffApplyError, applyDiff, diffIR, summarizeDiff } from "./utils/diff.js";
export { VersionHistoryError, type VersionHistoryErrorCode } from "./utils/errors.js";
export type { CreateVersionHistoryPluginOptions } from "./plugin.js";
export { createVersionHistoryPlugin } from "./plugin.js";
export type { IRDiff, IRDiffOp, IRDiffSummary } from "./utils/diff.js";
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
} from "./types/types.js";
