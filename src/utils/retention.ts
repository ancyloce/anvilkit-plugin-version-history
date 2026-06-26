import type { SnapshotAdapter, SnapshotMeta } from "../types/types.js";
import { compareBySavedAtAscending } from "./eviction.js";

/**
 * Declarative retention policy composed by {@link planRetention}. Every field
 * is optional and additive — supply either, both, or neither:
 *
 * - **`maxSnapshots`** — keep at most this many snapshots, evicting the oldest
 *   overflow (the historical count-only behavior of `evictOldest`). A
 *   non-finite or `< 1` value disables the count cap.
 * - **`maxAgeMs`** — evict any snapshot older than this many milliseconds
 *   relative to "now". A non-finite or `<= 0` value disables age expiry.
 *
 * Protected snapshots (see {@link RetentionPlanOptions.protectedIds} and the
 * `meta.protected` flag) are never evicted by either rule.
 */
export interface RetentionPolicy {
	readonly maxSnapshots?: number;
	readonly maxAgeMs?: number;
}

/**
 * Options for {@link planRetention} / {@link runRetention}.
 *
 * - **`now`** — injectable wall-clock used for age comparisons (defaults to
 *   `Date.now()`); pass a fixed value for deterministic age-based planning.
 * - **`protectedIds`** — snapshot ids that must never be evicted, regardless of
 *   age or count pressure.
 */
export interface RetentionPlanOptions {
	readonly now?: number;
	readonly protectedIds?: readonly string[];
}

/**
 * Deterministic deletion plan returned by {@link planRetention}. `deleteIds`
 * and `keepIds` partition the input ids and are both ordered oldest-first
 * (ascending `savedAt`, ascending `id` tie-break — matching `evictOldest`), so
 * the plan is reproducible for the same inputs.
 */
export interface RetentionPlan {
	readonly deleteIds: readonly string[];
	readonly keepIds: readonly string[];
}

/**
 * The slice of {@link SnapshotAdapter} {@link runRetention} needs: `list` to
 * read current metadata, plus the optional `deleteMany` / `delete` it uses to
 * apply the plan. Any full `SnapshotAdapter` satisfies it.
 */
export type RetentionAdapter = Pick<
	SnapshotAdapter,
	"list" | "delete" | "deleteMany"
>;

/** Options for {@link runRetention}: {@link RetentionPlanOptions} plus `dryRun`. */
export interface RunRetentionOptions extends RetentionPlanOptions {
	/** When `true`, compute and return the plan without deleting anything. */
	readonly dryRun?: boolean;
}

/**
 * Outcome of {@link runRetention}: the computed {@link RetentionPlan}, the ids
 * actually deleted (`[]` for a dry run or when nothing matched), and whether
 * this was a dry run.
 */
export interface RetentionResult {
	readonly plan: RetentionPlan;
	readonly deletedIds: readonly string[];
	readonly dryRun: boolean;
}

function normalizeCount(value: number | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const normalized = Math.trunc(value);
	if (!Number.isFinite(normalized) || normalized < 1) {
		return undefined;
	}
	return normalized;
}

function normalizeAge(value: number | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return value;
}

/**
 * Pure, deterministic retention planner. Composes the count cap, age expiry,
 * and protection rules of a {@link RetentionPolicy} into a single
 * {@link RetentionPlan} without mutating `snapshots` or touching any store.
 *
 * Semantics:
 * - **protection** — a snapshot is protected when its `id` is in
 *   `options.protectedIds` OR it carries a truthy `meta.protected` flag (read
 *   forward-compatibly, so no schema change is required). Protected snapshots
 *   are never in `deleteIds`, even if they are the oldest or age-expired.
 * - **age** — when `policy.maxAgeMs` is enabled, an unprotected snapshot is
 *   evicted when `now - Date.parse(savedAt) > maxAgeMs`. Unparseable `savedAt`
 *   values never expire (the `NaN` comparison is `false`).
 * - **count** — when `policy.maxSnapshots` is enabled, the oldest unprotected
 *   survivors (after age expiry) are evicted until at most `maxSnapshots`
 *   remain. Protected snapshots are always kept and still count toward the
 *   total, so the kept count can exceed the cap if enough are protected.
 *
 * `deleteIds` / `keepIds` are ordered oldest-first for reproducibility.
 */
export function planRetention(
	snapshots: readonly SnapshotMeta[],
	policy: RetentionPolicy,
	options: RetentionPlanOptions = {},
): RetentionPlan {
	const now = options.now ?? Date.now();
	const protectedIds = new Set(options.protectedIds ?? []);
	const ordered = [...snapshots].sort(compareBySavedAtAscending);

	const isProtected = (meta: SnapshotMeta): boolean =>
		protectedIds.has(meta.id) ||
		(meta as { protected?: boolean }).protected === true;

	const deleteSet = new Set<string>();

	const maxAgeMs = normalizeAge(policy.maxAgeMs);
	if (maxAgeMs !== undefined) {
		for (const meta of ordered) {
			if (isProtected(meta)) {
				continue;
			}
			if (now - Date.parse(meta.savedAt) > maxAgeMs) {
				deleteSet.add(meta.id);
			}
		}
	}

	const maxSnapshots = normalizeCount(policy.maxSnapshots);
	if (maxSnapshots !== undefined) {
		const survivors = ordered.filter((meta) => !deleteSet.has(meta.id));
		let overflow = survivors.length - maxSnapshots;
		// `survivors` is already oldest-first, so this evicts the oldest
		// unprotected entries until the cap is satisfied (or none remain).
		for (const meta of survivors) {
			if (overflow <= 0) {
				break;
			}
			if (isProtected(meta)) {
				continue;
			}
			deleteSet.add(meta.id);
			overflow -= 1;
		}
	}

	const deleteIds: string[] = [];
	const keepIds: string[] = [];
	for (const meta of ordered) {
		if (deleteSet.has(meta.id)) {
			deleteIds.push(meta.id);
		} else {
			keepIds.push(meta.id);
		}
	}

	return { deleteIds, keepIds };
}

/**
 * Manual cleanup API: plan retention over an adapter's current snapshots and
 * (unless `dryRun`) apply it. The plan is computed by {@link planRetention}
 * from `adapter.list()`. Deletions prefer the batch `adapter.deleteMany` and
 * fall back to per-id `adapter.delete`; if the adapter exposes neither, nothing
 * is deleted (`deletedIds` is `[]`).
 *
 * Pass `{ dryRun: true }` to preview the plan without mutating the store — the
 * returned {@link RetentionResult.plan} is identical to a real run, but
 * `deletedIds` is `[]` and no adapter mutation occurs.
 */
export async function runRetention(
	adapter: RetentionAdapter,
	policy: RetentionPolicy,
	options: RunRetentionOptions = {},
): Promise<RetentionResult> {
	const snapshots = await Promise.resolve(adapter.list());
	const plan = planRetention(snapshots, policy, {
		now: options.now,
		protectedIds: options.protectedIds,
	});

	const dryRun = options.dryRun === true;
	if (dryRun || plan.deleteIds.length === 0) {
		return { plan, deletedIds: [], dryRun };
	}

	if (adapter.deleteMany) {
		await Promise.resolve(adapter.deleteMany(plan.deleteIds));
	} else if (adapter.delete) {
		for (const id of plan.deleteIds) {
			await Promise.resolve(adapter.delete(id));
		}
	} else {
		// No delete capability — report the plan but nothing was removed.
		return { plan, deletedIds: [], dryRun: false };
	}

	return { plan, deletedIds: plan.deleteIds, dryRun: false };
}
