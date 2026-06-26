import type {
	SnapshotMeta,
	SnapshotPage,
	SnapshotQuery,
} from "../types/types.js";

type SnapshotSort = NonNullable<SnapshotQuery["sort"]>;

/**
 * Pure, deterministic reference implementation of the optional
 * {@link SnapshotAdapter.query} capability over an in-memory array.
 *
 * Reference adapters (in-memory, localStorage) implement `query` by
 * delegating here so the filter/sort/pagination semantics live in exactly
 * one place. `all` is never mutated.
 *
 * Semantics:
 * - **filter.label** — case-insensitive substring match. Snapshots without a
 *   `label` are excluded whenever a label filter is supplied.
 * - **sort** — when omitted, the input order is preserved (mirroring
 *   `list()`). When supplied, snapshots are ordered by `field`/`direction`
 *   with a stable ascending `id` tie-break (matching `evictOldest`), giving a
 *   strict total order so cursor pagination is reproducible.
 * - **cursor / limit** — `cursor` is the opaque `id` of the last item from a
 *   previous page; results resume immediately after it (an unknown cursor
 *   restarts from the head). An omitted, non-finite, or non-positive `limit`
 *   returns all remaining items. `nextCursor` is the last returned item's
 *   `id` when more items remain and is absent on the final page.
 */
export function querySnapshots(
	all: readonly SnapshotMeta[],
	options: SnapshotQuery = {},
): SnapshotPage {
	const filtered = filterByLabel(all, options.filter?.label);
	const ordered = options.sort
		? sortSnapshots(filtered, options.sort)
		: filtered;

	const startIndex = resolveStartIndex(ordered, options.cursor);
	const pageSize = resolvePageSize(options.limit);
	const endIndex =
		pageSize === undefined ? ordered.length : startIndex + pageSize;
	const items = ordered.slice(startIndex, endIndex);

	const hasMore = startIndex + items.length < ordered.length;
	const lastItem = items.at(-1);
	if (!hasMore || lastItem === undefined) {
		return { items };
	}

	return { items, nextCursor: lastItem.id };
}

function filterByLabel(
	all: readonly SnapshotMeta[],
	needle: string | undefined,
): readonly SnapshotMeta[] {
	if (needle === undefined) {
		return all;
	}

	const lowered = needle.toLowerCase();
	return all.filter(
		(meta) =>
			meta.label !== undefined && meta.label.toLowerCase().includes(lowered),
	);
}

function sortSnapshots(
	metas: readonly SnapshotMeta[],
	sort: SnapshotSort,
): readonly SnapshotMeta[] {
	const directionFactor = sort.direction === "desc" ? -1 : 1;

	return [...metas].sort((left, right) => {
		const primary = compareByField(sort.field, left, right) * directionFactor;
		if (primary !== 0) {
			return primary;
		}

		// Stable ascending id tie-break — mirrors `evictOldest` so ordering is
		// fully deterministic regardless of the requested sort direction.
		if (left.id < right.id) return -1;
		if (left.id > right.id) return 1;
		return 0;
	});
}

function compareByField(
	field: SnapshotSort["field"],
	left: SnapshotMeta,
	right: SnapshotMeta,
): number {
	if (field === "label") {
		const leftLabel = left.label ?? "";
		const rightLabel = right.label ?? "";
		if (leftLabel < rightLabel) return -1;
		if (leftLabel > rightLabel) return 1;
		return 0;
	}

	const leftTime = Date.parse(left.savedAt);
	const rightTime = Date.parse(right.savedAt);
	if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
		// `savedAt` accepts any string; fall back to lexicographic compare for
		// non-ISO values (mirrors `evictOldest`).
		if (left.savedAt < right.savedAt) return -1;
		if (left.savedAt > right.savedAt) return 1;
		return 0;
	}
	if (leftTime !== rightTime) {
		return leftTime - rightTime;
	}
	return 0;
}

function resolveStartIndex(
	ordered: readonly SnapshotMeta[],
	cursor: string | undefined,
): number {
	if (cursor === undefined) {
		return 0;
	}

	const index = ordered.findIndex((meta) => meta.id === cursor);
	return index === -1 ? 0 : index + 1;
}

function resolvePageSize(limit: number | undefined): number | undefined {
	if (limit === undefined) {
		return undefined;
	}

	const normalized = Math.trunc(limit);
	if (!Number.isFinite(normalized) || normalized < 1) {
		return undefined;
	}
	return normalized;
}
