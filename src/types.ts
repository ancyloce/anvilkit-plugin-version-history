import type { PageIR } from "@anvilkit/core/types";

export type MaybePromise<T> = T | Promise<T>;

export interface SnapshotMeta {
	readonly id: string;
	readonly label?: string;
	readonly savedAt: string;
	readonly pageIRHash: string;
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
