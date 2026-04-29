import type { PageIR } from "@anvilkit/core/types";
import { describe, expect, it } from "vitest";

import { inMemoryAdapter } from "../adapters/in-memory.js";
import { localStorageAdapter } from "../adapters/local-storage.js";
import type {
	PeerInfo,
	PresenceState,
	SnapshotAdapter,
	SnapshotAdapterPresence,
	Unsubscribe,
} from "../types.js";

describe("SnapshotAdapter v2 contract (additive)", () => {
	it("accepts existing inMemoryAdapter without subscribe/presence", () => {
		const adapter: SnapshotAdapter = inMemoryAdapter();
		expect(adapter.subscribe).toBeUndefined();
		expect(adapter.presence).toBeUndefined();
	});

	it("accepts existing localStorageAdapter without subscribe/presence", () => {
		const adapter: SnapshotAdapter = localStorageAdapter({
			namespace: "test",
		});
		expect(adapter.subscribe).toBeUndefined();
		expect(adapter.presence).toBeUndefined();
	});

	it("accepts a v2 adapter that implements subscribe and presence", () => {
		const presence: SnapshotAdapterPresence = {
			update(_state: PresenceState) {},
			onPeerChange(_cb): Unsubscribe {
				return () => {};
			},
		};

		const adapter: SnapshotAdapter = {
			save: () => "id",
			list: () => [],
			load: () => {
				throw new Error("not used");
			},
			subscribe(onUpdate: (ir: PageIR, peer?: PeerInfo) => void): Unsubscribe {
				void onUpdate;
				return () => {};
			},
			presence,
		};

		expect(typeof adapter.subscribe).toBe("function");
		expect(adapter.presence).toBe(presence);
	});
});
