/** @vitest-environment jsdom */

import { createFakePageIR } from "@anvilkit/core/testing";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { SnapshotMeta } from "../../types.js";
import { SnapshotList } from "../SnapshotList.js";

// The react-library Vitest preset disables RTL auto-cleanup (`globals:
// false`), so multi-render suites must unmount between tests — otherwise a
// prior render's rows leak into the next test's DOM queries.
afterEach(cleanup);

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

  it("windows a large list: only a capped subset of rows is mounted", () => {
    const currentIR = createFakePageIR();
    const snapshots: readonly SnapshotMeta[] = Array.from(
      { length: 200 },
      (_, index) => ({
        id: `snapshot-${index}`,
        label: `Snapshot ${index}`,
        pageIRHash: `hash-${index}`,
        savedAt: new Date(index * 1_000).toISOString(),
      }),
    );
    // Never resolves: keep each mounted row in its pending state so the
    // assertion only measures how many rows are physically in the DOM.
    const pendingLoad = new Promise<ReturnType<typeof createFakePageIR>>(
      () => {},
    );

    render(
      <SnapshotList
        currentIR={currentIR}
        loadSnapshot={() => pendingLoad}
        onOpen={() => {}}
        snapshots={snapshots}
      />,
    );

    // Virtualization must mount only the visible window (+ overscan), not a
    // DOM row per snapshot. The all-at-once render this guards against
    // mounts all 200; the shared `Windowed` primitive caps it far below
    // that (its jsdom 0-height fallback seeds a deterministic viewport).
    const rows = screen.getAllByRole("listitem");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(50);
  });
});
