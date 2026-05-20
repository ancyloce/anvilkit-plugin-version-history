import type { PageIR } from "@anvilkit/core/types";

/**
 * 128-bit fingerprint over the canonicalized JSON form of a `PageIR`,
 * built from four independent 32-bit FNV-1a lanes (distinct offset bases
 * + per-lane mixing). Returned as a 32-char lowercase hex string.
 *
 * Birthday-collision risk is negligible at any realistic snapshot count
 * (vs. ~50% at ~65k for the previous 32-bit hash). It is still a
 * *fingerprint* — a cheap change-detection label, not a cryptographic or
 * content-address hash. The value is opaque: width is not part of the
 * contract, and old 8-char hashes from prior versions remain valid
 * strings (the field is never used as a lookup key).
 */
export function hashPageIR(ir: PageIR): string {
  const canonical = JSON.stringify(canonicalize(ir));
  const lanes = [0x811c9dc5, 0x84222325, 0xc2b2ae35, 0x27d4eb2f];

  for (let index = 0; index < canonical.length; index += 1) {
    const code = canonical.charCodeAt(index);
    for (let lane = 0; lane < lanes.length; lane += 1) {
      let h = lanes[lane] as number;
      h = Math.imul(h ^ code, 0x01000193);
      // Per-lane shift so identical bytes diverge across lanes.
      h ^= h >>> (7 + lane);
      lanes[lane] = h;
    }
  }

  return lanes
    .map((lane) => (lane >>> 0).toString(16).padStart(8, "0"))
    .join("");
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
