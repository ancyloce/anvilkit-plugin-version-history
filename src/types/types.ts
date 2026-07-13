import type { PageIR } from "@anvilkit/core/types";

import type { IRDiff } from "../utils/diff.js";

/** A value that may be returned directly or as a promise. */
export type MaybePromise<T> = T | Promise<T>;

/**
 * Host-provided bridge that converts the live editor document returned by
 * `ctx.getData()` (in a real `<Studio>` session this is Puck `Data`, not
 * `PageIR`) into the `PageIR` the snapshot adapter persists.
 *
 * Threaded through {@link CreateVersionHistoryPluginOptions.buildIR}. The
 * header save action calls it only when the raw data is not already a
 * `PageIR` (the fast-path), so passing it is what makes "Save snapshot"
 * persist in production sessions. Return `null` to signal the current data
 * cannot be converted and the save should be skipped. May be sync or async.
 */
export type BuildPageIR = (data: unknown) => MaybePromise<PageIR | null>;

/**
 * Lightweight, listable descriptor of a stored snapshot — everything the UI
 * needs without materializing the full `PageIR`. Identity/provenance fields
 * (`id`, `savedAt`, `pageIRHash`, `delta`) are immutable; the rest is the
 * host-curated, patchable {@link SnapshotMetaPatch} subset.
 */
export interface SnapshotMeta {
	/** Adapter-assigned unique id; the key for `load`/`delete`/`updateMeta`. */
	readonly id: string;
	/** Optional short, human-readable name shown in the history list. */
	readonly label?: string;
	/** ISO-8601 timestamp of when the snapshot was captured. */
	readonly savedAt: string;
	/** Content hash of the captured `PageIR`; powers the optimistic-restore guard. */
	readonly pageIRHash: string;
	/**
	 * Structural diff from the immediately previous snapshot to this
	 * one (L2). Optional — only populated when the producing adapter
	 * opts in (e.g. `createYjsAdapter({ computeDelta: true })`). Useful
	 * for audit logs, undo-stack replay, and human-readable change
	 * summaries via `summarizeDiff` from `./diff.js`.
	 *
	 * Snapshots written by older adapter versions omit this field; the
	 * shape stays backward compatible.
	 */
	readonly delta?: IRDiff;
	/**
	 * Host-assigned labels for grouping, filtering, and searching snapshots
	 * (e.g. `["release", "qa"]`). Set at save time via
	 * {@link SnapshotAdapter.save} or amended later with
	 * {@link SnapshotAdapter.updateMeta}.
	 *
	 * Optional and backward compatible — records written before tagging
	 * existed omit it (treated as "no tags"); it is never required.
	 */
	readonly tags?: readonly string[];
	/**
	 * Marks this snapshot as a named milestone / checkpoint a host wants to
	 * surface prominently in version-history UIs (vs. an ordinary autosave).
	 *
	 * Optional and backward compatible — older records omit it, which is
	 * equivalent to `false` (not a milestone).
	 */
	readonly milestone?: boolean;
	/**
	 * When `true`, the snapshot is exempt from automatic retention eviction:
	 * `planRetention` reads this flag and never places a protected snapshot in
	 * its delete plan, regardless of age or count pressure.
	 *
	 * Optional and backward compatible — older records omit it, which is
	 * equivalent to "not protected".
	 */
	readonly protected?: boolean;
	/**
	 * Free-form author / actor attribution for audit trails (e.g. a user id,
	 * email, or display name). The package treats it as an opaque string and
	 * never parses it.
	 *
	 * Optional and backward compatible — older records omit it.
	 */
	readonly author?: string;
	/**
	 * Free-form, human-readable notes describing the snapshot — longer-form
	 * context than the short {@link SnapshotMeta.label}.
	 *
	 * Optional and backward compatible — older records omit it.
	 */
	readonly notes?: string;
}

/**
 * The mutable, host-curated subset of {@link SnapshotMeta} that
 * {@link SnapshotAdapter.updateMeta} may patch in place. The identity /
 * provenance fields (`id`, `savedAt`, `pageIRHash`, `delta`) are intentionally
 * excluded — they describe *what* was captured and *when*, and never change
 * after a snapshot is written.
 *
 * Every field is optional; an omitted field is left unchanged by the update.
 */
export interface SnapshotMetaPatch {
	readonly label?: string;
	readonly tags?: readonly string[];
	readonly milestone?: boolean;
	readonly protected?: boolean;
	readonly author?: string;
	readonly notes?: string;
}

/**
 * Optional query for paginating, filtering, and sorting snapshot metadata
 * via {@link SnapshotAdapter.query}. Every field is optional; an empty query
 * (`{}`) is equivalent to `list()` (all metadata, input order).
 */
export interface SnapshotQuery {
	/**
	 * Opaque resume token — the `id` of the last item from a previous page.
	 * Results continue immediately after it in the resolved order. An unknown
	 * cursor (e.g. the referenced snapshot was deleted) restarts from the head.
	 */
	readonly cursor?: string;
	/**
	 * Maximum number of items to return. An omitted, non-finite, or
	 * non-positive value returns all remaining items.
	 */
	readonly limit?: number;
	readonly sort?: {
		readonly field: "savedAt" | "label";
		readonly direction: "asc" | "desc";
	};
	readonly filter?: {
		/** Case-insensitive substring match against {@link SnapshotMeta.label}. */
		readonly label?: string;
	};
}

/**
 * A single page of snapshot metadata returned by {@link SnapshotAdapter.query}.
 */
export interface SnapshotPage {
	readonly items: readonly SnapshotMeta[];
	/**
	 * Resume token for the next page (the last item's `id`). Absent on the
	 * final page — i.e. when no further items remain.
	 */
	readonly nextCursor?: string;
}

/**
 * A single entry in a {@link VersionHistoryExport}: a snapshot's metadata
 * paired with its fully-materialized {@link PageIR}.
 *
 * Unlike an adapter's internal delta-chain record, the `ir` here is a
 * complete, standalone page (the chain is reconstructed during export), so
 * importing the entry reproduces a directly loadable snapshot.
 */
export interface VersionHistoryExportEntry {
	readonly meta: SnapshotMeta;
	readonly ir: PageIR;
}

/**
 * Self-contained, JSON-serializable archive of every snapshot in an adapter —
 * produced by {@link SnapshotAdapter.exportAll} and consumed by
 * {@link SnapshotAdapter.importAll}. Each entry carries a full `PageIR`, so a
 * round-trip `importAll(exportAll())` into a fresh adapter reproduces loadable
 * snapshots.
 *
 * `version` is the archive schema version (currently `1`) — bump it if the
 * envelope shape ever changes so importers can refuse or migrate older files.
 * This is intentionally NOT the adapter's internal delta-chain format.
 */
export interface VersionHistoryExport {
	readonly version: 1;
	readonly snapshots: readonly VersionHistoryExportEntry[];
}

/**
 * Options for {@link SnapshotAdapter.importAll}.
 *
 * - `"merge"` (default) — add the archive's snapshots to the existing store,
 *   overwriting any whose `id` already exists and appending the rest.
 * - `"replace"` — clear the existing store first, then import the archive.
 */
export interface VersionHistoryImportOptions {
	readonly mode?: "replace" | "merge";
}

/** Teardown handle returned by a subscription; call it to stop receiving updates. */
export type Unsubscribe = () => void;

/** Identity of a collaborator in a multiplayer session. */
export interface PeerInfo {
	/** Stable per-session peer id. */
	readonly id: string;
	/** Optional human-readable name for presence UIs. */
	readonly displayName?: string;
	/** Optional display color (e.g. for the peer's cursor/selection). */
	readonly color?: string;
}

/** A peer's pointer position, in canvas/document coordinates. */
export interface PresenceCursor {
	/** Horizontal coordinate. */
	readonly x: number;
	/** Vertical coordinate. */
	readonly y: number;
}

/** A peer's current selection, as the ids of the selected IR nodes. */
export interface PresenceSelection {
	/** Ids of the nodes the peer has selected. */
	readonly nodeIds: readonly string[];
}

/** A single peer's full presence snapshot (identity + cursor + selection). */
export interface PresenceState {
	/** Who this presence belongs to. */
	readonly peer: PeerInfo;
	/** The peer's pointer position, if broadcasting one. */
	readonly cursor?: PresenceCursor;
	/** The peer's current selection, if broadcasting one. */
	readonly selection?: PresenceSelection;
}

/**
 * Presence channel a collaborative adapter exposes for live cursors /
 * selections.
 *
 * Optional and **host / collaboration-adapter owned**: the bundled reference
 * adapters (in-memory, localStorage) are single-user and intentionally do not
 * implement it. Only a real multiplayer transport — e.g. a Yjs adapter such as
 * `@anvilkit/plugin-collab-yjs` (`YjsSnapshotAdapter`) — provides it, so this
 * interface lives here as the shared contract that collaborative adapters
 * implement, not something the reference adapters supply.
 */
export interface SnapshotAdapterPresence {
	/** Publish the local peer's presence to other collaborators. */
	update(state: PresenceState): void;
	/**
	 * Subscribe to the roster of remote peers' presence; `callback` fires with
	 * the full set whenever it changes. Returns an {@link Unsubscribe}.
	 */
	onPeerChange(
		callback: (peers: readonly PresenceState[]) => void,
	): Unsubscribe;
}

/**
 * Host-provided storage backend for snapshots — the single integration seam
 * between this plugin and a persistence layer (in-memory, localStorage, Yjs,
 * a REST API, …). `save`/`list`/`load` are the required core; everything else
 * is optional and must be feature-detected by callers, so older adapters keep
 * working unchanged. Methods may be sync or async.
 */
export interface SnapshotAdapter {
	/**
	 * Persist `ir` as a new snapshot and resolve to its newly assigned id.
	 * The adapter owns `id`/`savedAt` (hence they are omitted from the meta
	 * argument) and may store the IR as a delta against earlier snapshots.
	 */
	readonly save: (
		ir: PageIR,
		meta: Partial<Omit<SnapshotMeta, "id" | "savedAt">>,
	) => MaybePromise<string>;
	/** Return every snapshot's metadata in canonical save order. */
	readonly list: () => MaybePromise<readonly SnapshotMeta[]>;
	/**
	 * Optional paginated/filtered/sorted view over the same metadata `list()`
	 * returns. Additive and fully backward compatible — adapters that omit it
	 * are unaffected, and callers must feature-detect it. Reference adapters
	 * implement it by delegating to `querySnapshots` from `./utils/query.js`.
	 */
	readonly query?: (options: SnapshotQuery) => MaybePromise<SnapshotPage>;
	/**
	 * Materialize and return a snapshot's full `PageIR` by id, reconstructing
	 * it from the internal delta chain if needed. Throws a `SNAPSHOT_NOT_FOUND`
	 * {@link VersionHistoryError} for an unknown id.
	 */
	readonly load: (id: string) => MaybePromise<PageIR>;
	/**
	 * Optional single delete. Removes the snapshot `id` while keeping the rest
	 * loadable (adapters re-root any deltas that chained onto it). Additive and
	 * backward compatible — feature-detect it.
	 */
	readonly delete?: (id: string) => MaybePromise<void>;
	/**
	 * Optional batch delete for administrative cleanup. Removes every id in
	 * `ids` (unknown ids are ignored) while leaving the remaining snapshots
	 * loadable. Additive and fully backward compatible — adapters that omit it
	 * are unaffected and callers must feature-detect it. Equivalent in effect
	 * to calling `delete` per id, but adapters can implement it more
	 * efficiently (the reference localStorage adapter does a single index
	 * write).
	 */
	readonly deleteMany?: (ids: readonly string[]) => MaybePromise<void>;
	/**
	 * Optional portability export. Materializes every snapshot's full `PageIR`
	 * (reconstructing the internal delta chain via `load`) into a
	 * self-contained {@link VersionHistoryExport} archive in deterministic save
	 * order. Additive/optional — feature-detect it. Pairs with
	 * {@link importAll}.
	 */
	readonly exportAll?: () => MaybePromise<VersionHistoryExport>;
	/**
	 * Optional portability import. Restores snapshots from a
	 * {@link VersionHistoryExport} produced by {@link exportAll}. The default
	 * `"merge"` mode adds/overwrites by id; `"replace"` clears the store first.
	 * Imported snapshots preserve their original ids/metadata and are stored as
	 * standalone keyframes, so each is immediately loadable. Additive/optional —
	 * feature-detect it. Throws a `STORAGE_CORRUPT` {@link VersionHistoryError}
	 * (via `normalizeVersionHistoryExport`) when the archive is malformed.
	 */
	readonly importAll?: (
		data: VersionHistoryExport,
		options?: VersionHistoryImportOptions,
	) => MaybePromise<void>;
	/**
	 * Optional metadata update. Patches the mutable, host-curated fields of a
	 * stored snapshot's metadata (the {@link SnapshotMetaPatch} subset —
	 * label/tags/milestone/protected/author/notes) in place, leaving its
	 * `PageIR`/delta-chain record and identity fields (`id`/`savedAt`/
	 * `pageIRHash`/`delta`) untouched. Omitted patch fields are left unchanged.
	 *
	 * Additive and fully backward compatible — adapters that omit it are
	 * unaffected and callers must feature-detect it. Throws a
	 * `SNAPSHOT_NOT_FOUND` {@link VersionHistoryError} for an unknown id.
	 */
	readonly updateMeta?: (
		id: string,
		patch: SnapshotMetaPatch,
	) => MaybePromise<void>;
	/**
	 * Optional change subscription, **owned by the host / a collaborative
	 * adapter — not by the bundled reference adapters**. The in-memory and
	 * localStorage reference adapters are single-user and intentionally do not
	 * implement it; a real collaboration transport (e.g. a Yjs adapter such as
	 * `@anvilkit/plugin-collab-yjs`) supplies it. Callers must feature-detect it.
	 *
	 * When implemented, `onUpdate` fires whenever a remote peer mutates the
	 * shared document (with the new `ir` and the originating `peer` when known);
	 * the panel drops its load cache and re-lists so the diff view never shows a
	 * stale snapshot. Returns an {@link Unsubscribe}; call it to stop receiving
	 * updates (idempotent — calling it again after the first time is a no-op).
	 */
	readonly subscribe?: (
		onUpdate: (ir: PageIR, peer?: PeerInfo) => void,
	) => Unsubscribe;
	/**
	 * Optional presence channel for live cursors / selections, **owned by the
	 * host / a collaborative adapter — not by the bundled reference adapters**.
	 * The in-memory and localStorage reference adapters have no multiplayer
	 * awareness and intentionally do not implement it; a real collaboration
	 * transport (e.g. a Yjs adapter such as `@anvilkit/plugin-collab-yjs`)
	 * supplies it. Callers must feature-detect it. See
	 * {@link SnapshotAdapterPresence} for the channel contract.
	 */
	readonly presence?: SnapshotAdapterPresence;
}

/**
 * A lightweight pointer into `@anvilkit/plugin-canvas-studio`'s own
 * snapshot store (FR-073) — NOT a duplicate persisted copy. This plugin's
 * `SnapshotAdapter`/`SnapshotMeta` are `PageIR`-shaped and have no concept
 * of a `CanvasIR` snapshot's content (delta chains, `pageIRHash`, etc. don't
 * apply); canvas snapshot storage, loading, and restoring stay owned by
 * `plugin-canvas-studio`'s `CanvasSnapshotBridge`/`CanvasSnapshotAdapter`.
 * This plugin only tracks that a canvas save/open happened, so a shared
 * history UI can list both kinds of history side by side.
 */
export interface CanvasSnapshotReference {
	/** Always `"canvas"` — the namespace tag from `CanvasVersionHistoryEventPayload`. */
	readonly keyspace: "canvas";
	readonly designId: string;
	readonly snapshotId: string;
	/** When this plugin received the `save-requested` event. */
	readonly recordedAt: string;
}

/**
 * Capability surface this plugin contributes to `<Studio>`.
 *
 * Carried as the `Contributes` type parameter of the returned
 * `StudioPlugin` so a consumer can recover the adapter/snapshot types via
 * `InferPluginContributions<typeof plugins>` — full type-safety and
 * IntelliSense without importing this package's internals explicitly.
 */
export interface VersionHistoryContribution {
	readonly versionHistory: {
		readonly adapter: SnapshotAdapter;
		readonly snapshots: readonly SnapshotMeta[];
		/** Canvas-keyspace snapshot references received via the event bus (FR-073). */
		readonly canvasSnapshots: readonly CanvasSnapshotReference[];
	};
}
