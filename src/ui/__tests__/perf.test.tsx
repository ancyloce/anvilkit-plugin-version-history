/** @vitest-environment jsdom */

import { createFakePageIR } from "@anvilkit/core/testing";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SnapshotMeta } from "../../types.js";
import { SnapshotList } from "../SnapshotList.js";

describe("SnapshotList performance", () => {
  it("renders one hundred snapshots under the jsdom budget", () => {
    const currentIR = createFakePageIR();
    const snapshots: readonly SnapshotMeta[] = Array.from(
      { length: 100 },
      (_, index) => ({
        id: `snapshot-${index}`,
        label: `Snapshot ${index}`,
        pageIRHash: `hash-${index}`,
        savedAt: new Date(index * 1_000).toISOString(),
      }),
    );
    const pendingLoad = new Promise<ReturnType<typeof createFakePageIR>>(
      () => {},
    );
    const start = performance.now();

    render(
      <SnapshotList
        currentIR={currentIR}
        loadSnapshot={() => pendingLoad}
        onOpen={() => {}}
        snapshots={snapshots}
      />,
    );

    const end = performance.now();
    // Coarse gross-regression guard, not a precise benchmark. `pnpm test`
    // runs every workspace package's Vitest concurrently via Turbo, so this
    // jsdom render competes for CPU and its wall-clock balloons under load
    // (observed ~3.7s in a saturated full-suite run vs well under 1s in
    // isolation). The budget is deliberately loose so contention does not
    // flake CI; a pathological regression (e.g. O(n²) rendering) still trips
    // it even under contention.
    expect(end - start).toBeLessThan(6000);
  });
});
