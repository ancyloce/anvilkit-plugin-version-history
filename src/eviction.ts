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
		return left.savedAt.localeCompare(right.savedAt) || left.id.localeCompare(right.id);
	}

	return leftTime - rightTime || left.id.localeCompare(right.id);
}
