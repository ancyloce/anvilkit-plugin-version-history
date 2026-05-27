/** @vitest-environment jsdom */

import { createFakePageIR } from "@anvilkit/core/testing";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SnapshotMeta } from "../../types.js";
import { SnapshotList } from "../SnapshotList.js";

const SNAPSHOTS: readonly SnapshotMeta[] = [
  {
    id: "snapshot-1",
    label: "First snapshot",
    pageIRHash: "hash-1",
    savedAt: new Date(0).toISOString(),
  },
  {
    id: "snapshot-2",
    label: "Second snapshot",
    pageIRHash: "hash-2",
    savedAt: new Date(1_000).toISOString(),
  },
];

afterEach(cleanup);

describe("SnapshotList — eager fallback (no IntersectionObserver)", () => {
  it("renders snapshots with ARIA roles, keyboard nav, and eager load", async () => {
    const currentIR = createFakePageIR();
    const loadSnapshot = vi.fn(async () => currentIR);
    const onOpen = vi.fn();

    render(
      <SnapshotList
        currentIR={currentIR}
        loadSnapshot={loadSnapshot}
        onOpen={onOpen}
        snapshots={SNAPSHOTS}
      />,
    );

    expect(screen.getByRole("list", { name: "Snapshots" })).toBeTruthy();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);

    // jsdom has no IntersectionObserver, so rows fall back to loading
    // immediately on mount — the pre-lazy behavior.
    await waitFor(() => {
      expect(loadSnapshot).toHaveBeenCalledTimes(2);
    });

    rows[0]?.focus();
    fireEvent.keyDown(rows[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);

    fireEvent.keyDown(rows[1]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows[0]);

    fireEvent.keyDown(rows[1]!, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith("snapshot-2");
  });
});

describe("SnapshotList — lazy load (IntersectionObserver available)", () => {
  interface Triggerable {
    trigger(isIntersecting: boolean): void;
  }
  let observers: Triggerable[] = [];

  beforeEach(() => {
    observers = [];
    class MockIntersectionObserver implements Triggerable {
      private readonly cb: IntersectionObserverCallback;
      private readonly targets: Element[] = [];
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb;
        observers.push(this);
      }
      observe(target: Element): void {
        this.targets.push(target);
      }
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
      trigger(isIntersecting: boolean): void {
        this.cb(
          this.targets.map(
            (target) =>
              ({ isIntersecting, target }) as IntersectionObserverEntry,
          ),
          this as unknown as IntersectionObserver,
        );
      }
    }
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not load or diff a row until it intersects the viewport", () => {
    const currentIR = createFakePageIR();
    const loadSnapshot = vi.fn(async () => currentIR);

    render(
      <SnapshotList
        currentIR={currentIR}
        loadSnapshot={loadSnapshot}
        onOpen={vi.fn()}
        snapshots={SNAPSHOTS}
      />,
    );

    // Rows mounted but not yet visible → no work done up front.
    expect(loadSnapshot).not.toHaveBeenCalled();
    expect(screen.getAllByText("Loading...")).toHaveLength(2);
    // One observer was created per row.
    expect(observers.length).toBe(2);
  });

  it("loads + diffs a row once it intersects", async () => {
    const currentIR = createFakePageIR();
    const loadSnapshot = vi.fn(async () => currentIR);

    render(
      <SnapshotList
        currentIR={currentIR}
        loadSnapshot={loadSnapshot}
        onOpen={vi.fn()}
        snapshots={SNAPSHOTS}
      />,
    );

    expect(loadSnapshot).not.toHaveBeenCalled();

    act(() => {
      for (const observer of observers) {
        observer.trigger(true);
      }
    });

    await waitFor(() => {
      expect(loadSnapshot).toHaveBeenCalledTimes(2);
    });
  });
});
