import type { PageIR } from "@anvilkit/core/types";

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
