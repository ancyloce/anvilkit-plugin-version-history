import type { PageIR } from "@anvilkit/core/types";

import type { IRDiff } from "../utils/diff.js";

export type MaybePromise<T> = T | Promise<T>;

export interface SnapshotMeta {
	readonly id: string;
	readonly label?: string;
	readonly savedAt: string;
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
}

export type Unsubscribe = () => void;

export interface PeerInfo {
	readonly id: string;
	readonly displayName?: string;
	readonly color?: string;
}

export interface PresenceCursor {
	readonly x: number;
	readonly y: number;
}

export interface PresenceSelection {
	readonly nodeIds: readonly string[];
}

export interface PresenceState {
	readonly peer: PeerInfo;
	readonly cursor?: PresenceCursor;
	readonly selection?: PresenceSelection;
}

export interface SnapshotAdapterPresence {
	update(state: PresenceState): void;
	onPeerChange(
		callback: (peers: readonly PresenceState[]) => void,
	): Unsubscribe;
}

export interface SnapshotAdapter {
	readonly save: (
		ir: PageIR,
		meta: Partial<Omit<SnapshotMeta, "id" | "savedAt">>,
	) => MaybePromise<string>;
	readonly list: () => MaybePromise<readonly SnapshotMeta[]>;
	readonly load: (id: string) => MaybePromise<PageIR>;
	readonly delete?: (id: string) => MaybePromise<void>;
	readonly subscribe?: (
		onUpdate: (ir: PageIR, peer?: PeerInfo) => void,
	) => Unsubscribe;
	readonly presence?: SnapshotAdapterPresence;
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
	};
}
