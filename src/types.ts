import type { PageIR } from "@anvilkit/core/types";

export type MaybePromise<T> = T | Promise<T>;

export interface SnapshotMeta {
	readonly id: string;
	readonly label?: string;
	readonly savedAt: string;
	readonly pageIRHash: string;
}

export interface SnapshotAdapter {
	readonly save: (
		ir: PageIR,
		meta: Partial<Omit<SnapshotMeta, "id" | "savedAt">>,
	) => MaybePromise<string>;
	readonly list: () => MaybePromise<readonly SnapshotMeta[]>;
	readonly load: (id: string) => MaybePromise<PageIR>;
	readonly delete?: (id: string) => MaybePromise<void>;
}
