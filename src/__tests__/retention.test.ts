import { describe, expect, it } from "vitest";

import type { SnapshotMeta } from "../types/types.js";
import {
	planRetention,
	type RetentionAdapter,
	runRetention,
} from "../utils/retention.js";

const NOW = Date.parse("2024-06-01T00:00:00.000Z");
const DAY = 86_400_000;

/** ISO timestamp `days` days before {@link NOW}. */
function ago(days: number): string {
	return new Date(NOW - days * DAY).toISOString();
}

function meta(
	id: string,
	savedAt: string,
	extra: { readonly label?: string; readonly protected?: boolean } = {},
): SnapshotMeta {
	const base: Record<string, unknown> = {
		id,
		savedAt,
		pageIRHash: `hash-${id}`,
	};
	if (extra.label !== undefined) {
		base.label = extra.label;
	}
	if (extra.protected !== undefined) {
		base.protected = extra.protected;
	}
	return base as unknown as SnapshotMeta;
}

// Ascending by savedAt: a (oldest) < b < c < d (newest).
const SAMPLE: readonly SnapshotMeta[] = Object.freeze([
	meta("a", ago(100)),
	meta("b", ago(50)),
	meta("c", ago(10)),
	meta("d", ago(1)),
]);

describe("planRetention", () => {
	it("keeps everything for an empty policy (deterministic oldest-first order)", () => {
		const plan = planRetention(SAMPLE, {}, { now: NOW });
		expect(plan.deleteIds).toEqual([]);
		expect(plan.keepIds).toEqual(["a", "b", "c", "d"]);
	});

	it("age-expires snapshots older than maxAgeMs using the injected now", () => {
		const plan = planRetention(SAMPLE, { maxAgeMs: 30 * DAY }, { now: NOW });
		// a (100d) and b (50d) exceed 30d; c (10d) and d (1d) do not.
		expect(plan.deleteIds).toEqual(["a", "b"]);
		expect(plan.keepIds).toEqual(["c", "d"]);
	});

	it("does not expire a snapshot exactly at the maxAgeMs boundary", () => {
		// b is exactly 50 days old; maxAgeMs == 50 days → now - savedAt == maxAgeMs,
		// which is NOT strictly greater, so b survives.
		const plan = planRetention(SAMPLE, { maxAgeMs: 50 * DAY }, { now: NOW });
		expect(plan.deleteIds).toEqual(["a"]);
		expect(plan.keepIds).toEqual(["b", "c", "d"]);
	});

	it("enforces the count cap by deleting the oldest overflow", () => {
		const plan = planRetention(SAMPLE, { maxSnapshots: 2 }, { now: NOW });
		expect(plan.deleteIds).toEqual(["a", "b"]);
		expect(plan.keepIds).toEqual(["c", "d"]);
	});

	it("treats a non-positive or non-finite maxSnapshots as 'no cap'", () => {
		expect(planRetention(SAMPLE, { maxSnapshots: 0 }).deleteIds).toEqual([]);
		expect(
			planRetention(SAMPLE, { maxSnapshots: Number.NaN }).deleteIds,
		).toEqual([]);
	});

	it("combines count + age (age is more aggressive here)", () => {
		const plan = planRetention(
			SAMPLE,
			{ maxSnapshots: 2, maxAgeMs: 5 * DAY },
			{ now: NOW },
		);
		// Age removes a, b, c (all > 5d); only d remains, already <= cap.
		expect(plan.deleteIds).toEqual(["a", "b", "c"]);
		expect(plan.keepIds).toEqual(["d"]);
	});

	it("combines count + age (count is more aggressive here)", () => {
		const plan = planRetention(
			SAMPLE,
			{ maxSnapshots: 1, maxAgeMs: 365 * DAY },
			{ now: NOW },
		);
		// Nothing age-expires; cap of 1 deletes the oldest three.
		expect(plan.deleteIds).toEqual(["a", "b", "c"]);
		expect(plan.keepIds).toEqual(["d"]);
	});

	it("never deletes a snapshot protected via protectedIds — even the oldest under a count cap", () => {
		const plan = planRetention(
			SAMPLE,
			{ maxSnapshots: 2 },
			{ now: NOW, protectedIds: ["a"] },
		);
		// 'a' is protected, so the cap evicts the next-oldest unprotected (b, c).
		expect(plan.deleteIds).toEqual(["b", "c"]);
		expect(plan.deleteIds).not.toContain("a");
		expect(plan.keepIds).toEqual(["a", "d"]);
	});

	it("never age-expires a snapshot protected via protectedIds", () => {
		const plan = planRetention(
			SAMPLE,
			{ maxAgeMs: 30 * DAY },
			{ now: NOW, protectedIds: ["a"] },
		);
		// 'a' would expire (100d) but is protected; 'b' (50d) still expires.
		expect(plan.deleteIds).toEqual(["b"]);
		expect(plan.keepIds).toEqual(["a", "c", "d"]);
	});

	it("never deletes a snapshot protected via meta.protected === true", () => {
		const sample: readonly SnapshotMeta[] = [
			meta("a", ago(100), { protected: true }),
			meta("b", ago(50)),
			meta("c", ago(10)),
			meta("d", ago(1)),
		];
		// An aggressive age policy plus a count cap must still spare 'a'.
		const plan = planRetention(
			sample,
			{ maxSnapshots: 2, maxAgeMs: 5 * DAY },
			{ now: NOW },
		);
		expect(plan.deleteIds).not.toContain("a");
		expect(plan.keepIds).toContain("a");
		// b and c expire by age; a (protected) and d remain within the cap of 2.
		expect(plan.deleteIds).toEqual(["b", "c"]);
		expect(plan.keepIds).toEqual(["a", "d"]);
	});

	it("orders deleteIds oldest-first with an ascending id tie-break", () => {
		const sameTime = ago(7);
		const tied: readonly SnapshotMeta[] = [
			meta("c", sameTime),
			meta("a", sameTime),
			meta("b", sameTime),
		];
		const plan = planRetention(tied, { maxSnapshots: 1 }, { now: NOW });
		// Sorted: a, b, c (id tie-break); cap of 1 deletes the oldest two.
		expect(plan.deleteIds).toEqual(["a", "b"]);
		expect(plan.keepIds).toEqual(["c"]);
	});

	it("does not mutate the input array", () => {
		const before = [...SAMPLE];
		planRetention(
			SAMPLE,
			{ maxSnapshots: 1, maxAgeMs: DAY },
			{ now: NOW, protectedIds: ["a"] },
		);
		expect([...SAMPLE]).toEqual(before);
	});
});

interface FakeAdapter {
	readonly adapter: RetentionAdapter;
	remaining(): readonly SnapshotMeta[];
	readonly deleteManyCalls: string[][];
	readonly deleteCalls: string[];
}

function fakeAdapter(
	initial: readonly SnapshotMeta[],
	caps: { readonly deleteMany: boolean },
): FakeAdapter {
	let store: SnapshotMeta[] = [...initial];
	const deleteManyCalls: string[][] = [];
	const deleteCalls: string[] = [];

	const adapter: RetentionAdapter = {
		list: () => store,
		delete: (id: string) => {
			deleteCalls.push(id);
			store = store.filter((m) => m.id !== id);
		},
		...(caps.deleteMany
			? {
					deleteMany: (ids: readonly string[]) => {
						deleteManyCalls.push([...ids]);
						const set = new Set(ids);
						store = store.filter((m) => !set.has(m.id));
					},
				}
			: {}),
	};

	return {
		adapter,
		remaining: () => store,
		deleteManyCalls,
		deleteCalls,
	};
}

describe("runRetention", () => {
	it("dry-run returns the plan but deletes nothing", async () => {
		const fake = fakeAdapter(SAMPLE, { deleteMany: true });
		const result = await runRetention(
			fake.adapter,
			{ maxSnapshots: 2 },
			{ now: NOW, dryRun: true },
		);

		expect(result.dryRun).toBe(true);
		expect(result.plan.deleteIds).toEqual(["a", "b"]);
		expect(result.deletedIds).toEqual([]);
		// Adapter state is completely untouched.
		expect(fake.remaining().map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
		expect(fake.deleteManyCalls).toEqual([]);
		expect(fake.deleteCalls).toEqual([]);
	});

	it("deletes via deleteMany when available (preferred over delete)", async () => {
		const fake = fakeAdapter(SAMPLE, { deleteMany: true });
		const result = await runRetention(
			fake.adapter,
			{ maxSnapshots: 2 },
			{ now: NOW },
		);

		expect(result.dryRun).toBe(false);
		expect(result.deletedIds).toEqual(["a", "b"]);
		expect(fake.deleteManyCalls).toEqual([["a", "b"]]);
		// deleteMany was preferred; the per-id fallback was never used.
		expect(fake.deleteCalls).toEqual([]);
		expect(fake.remaining().map((m) => m.id)).toEqual(["c", "d"]);
	});

	it("falls back to per-id delete when deleteMany is absent", async () => {
		const fake = fakeAdapter(SAMPLE, { deleteMany: false });
		const result = await runRetention(
			fake.adapter,
			{ maxSnapshots: 2 },
			{ now: NOW },
		);

		expect(result.deletedIds).toEqual(["a", "b"]);
		expect(fake.deleteCalls).toEqual(["a", "b"]);
		expect(fake.remaining().map((m) => m.id)).toEqual(["c", "d"]);
	});

	it("honors protectedIds when running against an adapter", async () => {
		const fake = fakeAdapter(SAMPLE, { deleteMany: true });
		const result = await runRetention(
			fake.adapter,
			{ maxSnapshots: 2 },
			{ now: NOW, protectedIds: ["a"] },
		);

		expect(result.deletedIds).toEqual(["b", "c"]);
		expect(fake.deleteManyCalls).toEqual([["b", "c"]]);
		expect(fake.remaining().map((m) => m.id)).toEqual(["a", "d"]);
	});

	it("returns an empty result and makes no calls when nothing needs deleting", async () => {
		const fake = fakeAdapter(SAMPLE, { deleteMany: true });
		const result = await runRetention(fake.adapter, {}, { now: NOW });

		expect(result.dryRun).toBe(false);
		expect(result.plan.deleteIds).toEqual([]);
		expect(result.deletedIds).toEqual([]);
		expect(fake.deleteManyCalls).toEqual([]);
		expect(fake.deleteCalls).toEqual([]);
		expect(fake.remaining()).toHaveLength(4);
	});
});
