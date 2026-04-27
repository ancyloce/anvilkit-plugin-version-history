import type { SnapshotMeta } from "./types.js";

export function evictOldest(
	metas: readonly SnapshotMeta[],
	maxSnapshots: number,
): string[] {
	const normalizedMax = Math.trunc(maxSnapshots);
	if (!Number.isFinite(normalizedMax) || normalizedMax < 1) {
		return [];
	}

	const overflow = metas.length - normalizedMax;
	if (overflow <= 0) {
		return [];
	}

	return [...metas]
		.sort(compareBySavedAtAscending)
		.slice(0, overflow)
		.map((meta) => meta.id);
}

function compareBySavedAtAscending(
	left: SnapshotMeta,
	right: SnapshotMeta,
): number {
	const leftTime = Date.parse(left.savedAt);
	const rightTime = Date.parse(right.savedAt);

	if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
		// ISO-8601 strings sort lexicographically, but the field accepts any
		// string — fall back to direct compare and break ties on id.
		if (left.savedAt < right.savedAt) return -1;
		if (left.savedAt > right.savedAt) return 1;
		if (left.id < right.id) return -1;
		if (left.id > right.id) return 1;
		return 0;
	}

	if (leftTime !== rightTime) {
		return leftTime - rightTime;
	}
	if (left.id < right.id) return -1;
	if (left.id > right.id) return 1;
	return 0;
}
