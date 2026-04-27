import type { PageIR } from "@anvilkit/core/types";

/**
 * 32-bit FNV-1a fingerprint over the canonicalized JSON form of a `PageIR`.
 *
 * Intended as a cheap change-detection label only. **Not** a content hash —
 * the 32-bit space gives ~50% birthday collision risk at ~65k snapshots, so
 * do not use this output as a deduplication key or as the primary identifier
 * for snapshot lookup. If a content-addressed store is needed, swap in a
 * 64-bit (or wider) hash and migrate the `pageIRHash` field accordingly.
 */
export function hashPageIR(ir: PageIR): string {
	const canonical = JSON.stringify(canonicalize(ir));
	let hash = 0x811c9dc5;

	for (let index = 0; index < canonical.length; index += 1) {
		hash ^= canonical.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}

	return (hash >>> 0).toString(16).padStart(8, "0");
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => canonicalize(item));
	}

	if (value !== null && typeof value === "object") {
		const normalized: Record<string, unknown> = {};
		const entries = Object.entries(value as Record<string, unknown>).sort(
			([left], [right]) => left.localeCompare(right),
		);

		for (const [key, entry] of entries) {
			if (entry !== undefined) {
				normalized[key] = canonicalize(entry);
			}
		}

		return normalized;
	}

	return value;
}
