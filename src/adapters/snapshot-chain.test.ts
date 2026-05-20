import { createFakePageIR } from "@anvilkit/core/testing";
import type { PageIRNode } from "@anvilkit/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inMemoryAdapter } from "./in-memory.js";
import { localStorageAdapter } from "./local-storage.js";
import { KEYFRAME_INTERVAL } from "./snapshot-chain.js";

class MemoryStorage implements Storage {
  #items = new Map<string, string>();
  get length(): number {
    return this.#items.size;
  }
  clear(): void {
    this.#items.clear();
  }
  getItem(key: string): string | null {
    return this.#items.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.#items.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.#items.delete(key);
  }
  setItem(key: string, value: string): void {
    this.#items.set(key, value);
  }
}

/** Stable root id (so diffs are representable), varying child prop. */
function irAt(revision: number) {
  return createFakePageIR({
    rootId: "root",
    children: [
      {
        id: "hero",
        type: "Hero",
        props: { headline: `Revision ${revision}` },
      } satisfies PageIRNode,
    ],
    metadata: { revision },
  });
}

describe("delta-chain storage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores keyframes + deltas and round-trips every snapshot losslessly", async () => {
    const adapter = localStorageAdapter({ namespace: "vh" });
    const saved: { id: string; ir: ReturnType<typeof irAt> }[] = [];

    for (let revision = 0; revision <= KEYFRAME_INTERVAL + 2; revision += 1) {
      const ir = irAt(revision);
      const id = await Promise.resolve(adapter.save(ir, {}));
      saved.push({ id, ir });
    }

    const kindOf = (id: string) =>
      JSON.parse(localStorage.getItem(`vh:snapshots:${id}`) as string).kind;

    // Keyframes land at save #0 and save #KEYFRAME_INTERVAL.
    expect(kindOf(saved[0]!.id)).toBe("full");
    expect(kindOf(saved[KEYFRAME_INTERVAL]!.id)).toBe("full");
    expect(kindOf(saved[1]!.id)).toBe("delta");
    expect(kindOf(saved[KEYFRAME_INTERVAL - 1]!.id)).toBe("delta");

    for (const { id, ir } of saved) {
      expect(await Promise.resolve(adapter.load(id))).toEqual(ir);
    }
  });

  it("reads legacy raw-PageIR records written by older versions", async () => {
    const adapter = localStorageAdapter({ namespace: "vh" });
    const legacy = irAt(7);

    // Pre-delta-chain layout: index entry + raw PageIR record payload.
    localStorage.setItem(
      "vh:snapshots:index",
      JSON.stringify([
        {
          id: "legacy-1",
          savedAt: "2026-01-01T00:00:00.000Z",
          pageIRHash: "old",
        },
      ]),
    );
    localStorage.setItem("vh:snapshots:legacy-1", JSON.stringify(legacy));

    expect(await Promise.resolve(adapter.load("legacy-1"))).toEqual(legacy);
    expect((await Promise.resolve(adapter.list())).map((s) => s.id)).toEqual([
      "legacy-1",
    ]);
  });

  it("re-roots dependents so evicting a base keyframe keeps the chain loadable", async () => {
    const adapter = inMemoryAdapter();
    const base = irAt(0);
    const child = irAt(1);
    const grandchild = irAt(2);

    const baseId = await Promise.resolve(adapter.save(base, {}));
    await Promise.resolve(adapter.save(child, {}));
    await Promise.resolve(adapter.save(grandchild, {}));

    // Delete the original keyframe the later deltas chain back to.
    await Promise.resolve(adapter.delete?.(baseId));

    const remaining = await Promise.resolve(adapter.list());
    expect(remaining).toHaveLength(2);
    for (const meta of remaining) {
      const loaded = await Promise.resolve(adapter.load(meta.id));
      expect(loaded.version).toBe("1");
    }
    // The chain still reconstructs the exact later revisions.
    const [childMeta, grandchildMeta] = remaining;
    expect(await Promise.resolve(adapter.load(childMeta!.id))).toEqual(child);
    expect(await Promise.resolve(adapter.load(grandchildMeta!.id))).toEqual(
      grandchild,
    );
  });
});
