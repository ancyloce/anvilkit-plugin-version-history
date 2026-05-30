# @anvilkit/plugin-version-history

> **Alpha (`0.1.4`).** Header actions and the diff/apply engine are stable. The sidebar-panel slot contribution is deferred until `StudioPluginContext` exposes the sidebar registration API.

Headless version-history plugin for Anvilkit Studio. Snapshot persistence is delegated to a host-provided `SnapshotAdapter`, so the plugin itself ships no I/O — only the diff/apply engine, header actions, optional UI primitives, and reference adapters for tests and demos.

## Installation

```bash
pnpm add @anvilkit/plugin-version-history react react-dom @puckeditor/core
```

Non-optional peers: `react >=19.0.0`, `react-dom >=19.0.0`, `@puckeditor/core ^0.21.2`. No transport or storage dependencies — the host owns persistence end-to-end.

Subpath imports:

- `@anvilkit/plugin-version-history` — main entry: plugin factory, reference adapters, diff/apply engine, types.
- `@anvilkit/plugin-version-history/ui` — optional React components (`VersionHistoryUI`, `SaveSnapshotButton`, `SnapshotList`, `SnapshotHistoryModal`, `DiffView`).
- `@anvilkit/plugin-version-history/testing` — `runAdapterContract` shared test suite.

## Quickstart

```ts
import {
  createVersionHistoryPlugin,
  localStorageAdapter,
} from "@anvilkit/plugin-version-history";

const plugin = createVersionHistoryPlugin({
  adapter: localStorageAdapter({ namespace: "my-app-history" }),
  maxSnapshots: 50,
});

// Pass `plugin` alongside other Studio plugins.
```

The plugin contributes two header actions (`version-history:save` and `version-history:open`) and emits `version-history:save-requested` / `version-history:open-requested` on the Studio event bus. Hosts handle the open event by mounting a UI surface (e.g., `<SnapshotHistoryModal>` from the `/ui` subpath).

## Core features

- **Adapter-driven persistence** — the plugin defines the contract; the host implements `save` / `list` / `load` / `delete?` and gets full control over storage (in-memory, localStorage, Firestore, S3, …).
- **Deterministic diff/apply engine** — `diffIR(a, b)` produces a frozen `IRDiff`; `applyDiff(a, diff)` round-trips.
- **Optional UI** — five components on `/ui` for hosts that want batteries-included version history. The default export imports none of them, so headless consumers pay no UI rendering cost.
- **FIFO eviction** — `maxSnapshots` automatically deletes the oldest snapshot when capacity is reached (requires `adapter.delete`).
- **Reference adapters** — `inMemoryAdapter()` for tests, `localStorageAdapter({ namespace })` for demos.
- **Adapter test suite** — `runAdapterContract` is the same contract the reference adapters use; consumers can validate their own implementation against it.
- **Bundle budget** — 8 KB gzipped enforced in CI via `scripts/check-bundle-budget.mjs`.

## API reference

### Factory

```ts
function createVersionHistoryPlugin(
  options: CreateVersionHistoryPluginOptions,
): StudioPlugin;

interface CreateVersionHistoryPluginOptions {
  readonly adapter: SnapshotAdapter;
  readonly maxSnapshots?: number;
}
```

Returns a typed `StudioPlugin` carrying the `VersionHistoryContribution` capability (so downstream consumers can recover `adapter` / `snapshots` via `InferPluginContributions`).

### `SnapshotAdapter` contract

```ts
interface SnapshotAdapter {
  save(
    ir: PageIR,
    meta: Partial<Omit<SnapshotMeta, "id" | "savedAt">>,
  ): MaybePromise<string>;
  list(): MaybePromise<readonly SnapshotMeta[]>;
  load(id: string): MaybePromise<PageIR>;
  delete?(id: string): MaybePromise<void>;
  subscribe?(onUpdate: (ir: PageIR, peer?: PeerInfo) => void): Unsubscribe;
  presence?: SnapshotAdapterPresence;
}
```

| Method           | Required? | Purpose                                                                   |
| ---------------- | --------- | ------------------------------------------------------------------------- |
| `save(ir, meta)` | yes       | Persist a `PageIR`. Returns a unique snapshot id.                         |
| `list()`         | yes       | Return all snapshots in order (newest-first by convention).               |
| `load(id)`       | yes       | Hydrate by id. Throw `VersionHistoryError("SNAPSHOT_NOT_FOUND")` on miss. |
| `delete(id)`     | optional  | Required when `maxSnapshots` is set.                                      |
| `subscribe(cb)`  | optional  | Push updates from collaborative adapters (e.g., `createYjsAdapter`).      |
| `presence`       | optional  | Multi-user cursor / selection channel. Implemented by the Yjs adapter.    |

All methods may be sync or async (`MaybePromise<T>`). Frozen, structurally-equal results are recommended.

### `SnapshotMeta`

```ts
interface SnapshotMeta {
  readonly id: string;
  readonly label?: string;
  readonly savedAt: string;
  readonly pageIRHash: string;
  readonly delta?: IRDiff;
}
```

`delta` is optional. Adapters that opt in (`createYjsAdapter({ computeDelta: true })`) populate it with the structural diff from the previous snapshot; older or simpler adapters omit it.

### Diff engine

| Export           | Signature                             | Purpose                                                                  |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| `diffIR`         | `(a: PageIR, b: PageIR) => IRDiff`    | Compute a deterministic, frozen diff.                                    |
| `applyDiff`      | `(a: PageIR, diff: IRDiff) => PageIR` | Apply a diff. `applyDiff(a, diffIR(a, b))` is structurally equal to `b`. |
| `summarizeDiff`  | `(diff: IRDiff) => IRDiffSummary`     | `{ added, removed, moved, changed, metaChanged?, description }`.         |
| `DiffApplyError` | `class extends Error`                 | Thrown when `applyDiff` cannot reconcile the diff against the input IR.  |

### `IRDiffOp` (discriminated union)

```ts
type IRDiffOp =
  | { kind: "add-node"; path: string; node: PageIRNode }
  | { kind: "remove-node"; path: string; nodeId: string }
  | { kind: "move-node"; from: string; to: string; nodeId: string }
  | {
      kind: "change-prop";
      path: string;
      key: string;
      before: unknown;
      after: unknown;
    }
  | {
      kind: "change-children";
      path: string;
      before: readonly string[];
      after: readonly string[];
    }
  | {
      kind: "meta-changed";
      path: string;
      key: "locked" | "owner" | "version" | "notes";
      before: unknown;
      after: unknown;
    };
```

### Reference adapters

| Adapter                              | Use case                | Notes                                                                                                                                                                                                                                                                          |
| ------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `inMemoryAdapter()`                  | Tests                   | Deep-freezes stored IRs; loses data on reload.                                                                                                                                                                                                                                 |
| `localStorageAdapter({ namespace })` | Demos, single-user SPAs | Storage keys: `<namespace>:snapshots:<id>` (payload), `<namespace>:snapshots:index` (metadata array). Uses delta-chain encoding to fit within the ~5–10 MB quota. Throws `VersionHistoryError` with one of `STORAGE_UNAVAILABLE`, `STORAGE_CORRUPT`, `STORAGE_QUOTA_EXCEEDED`. |

### Errors

```ts
class VersionHistoryError extends Error {
  readonly code: VersionHistoryErrorCode;
}

type VersionHistoryErrorCode =
  | "SNAPSHOT_NOT_FOUND"
  | "STORAGE_CORRUPT"
  | "STORAGE_QUOTA_EXCEEDED"
  | "STORAGE_UNAVAILABLE";
```

### Optional UI (`./ui`)

| Component              | Key props                                               |
| ---------------------- | ------------------------------------------------------- |
| `VersionHistoryUI`     | `{ adapter, currentIR, onRestore }`                     |
| `SaveSnapshotButton`   | `{ adapter, currentIR, getLabel? }`                     |
| `SnapshotList`         | `{ snapshots, onSelect, currentId? }`                   |
| `SnapshotHistoryModal` | `{ open, onOpenChange, adapter, currentIR, onRestore }` |
| `DiffView`             | `{ diff, before?, after? }`                             |

The `/ui` subpath is a separate entry point — importing from it does not trigger the rest of the package. The default plugin export does not reference these components.

### Testing (`./testing`)

```ts
runAdapterContract(
  adapterFactory: () => SnapshotAdapter,
  hooks: { describe; expect; it },
): void;
```

Pass your test runner's primitives to inject the suite without coupling the package to a specific framework.

## Usage examples

### LocalStorage adapter for a single-user SPA

```ts
import {
  createVersionHistoryPlugin,
  localStorageAdapter,
} from "@anvilkit/plugin-version-history";

const versionHistory = createVersionHistoryPlugin({
  adapter: localStorageAdapter({ namespace: "marketing-cms" }),
  maxSnapshots: 100,
});
```

### Custom Firestore adapter

```ts
import type {
  PageIR,
  SnapshotAdapter,
  SnapshotMeta,
} from "@anvilkit/plugin-version-history";
import { VersionHistoryError } from "@anvilkit/plugin-version-history";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  getDocs,
  collection,
  query,
  orderBy,
} from "firebase/firestore";

export function firestoreAdapter(roomId: string): SnapshotAdapter {
  const col = collection(db, "rooms", roomId, "snapshots");
  return {
    async save(ir, meta) {
      const id = crypto.randomUUID();
      const savedAt = new Date().toISOString();
      await setDoc(doc(col, id), { ir, meta: { ...meta, id, savedAt } });
      return id;
    },
    async list() {
      const snaps = await getDocs(query(col, orderBy("meta.savedAt", "desc")));
      return snaps.docs.map((d) => d.data().meta as SnapshotMeta);
    },
    async load(id) {
      const snap = await getDoc(doc(col, id));
      if (!snap.exists()) {
        throw new VersionHistoryError(
          "SNAPSHOT_NOT_FOUND",
          `snapshot ${id} not found`,
        );
      }
      return snap.data().ir as PageIR;
    },
    async delete(id) {
      await deleteDoc(doc(col, id));
    },
  };
}
```

### Validating a custom adapter

```ts
import { runAdapterContract } from "@anvilkit/plugin-version-history/testing";
import { describe, expect, it } from "vitest";

import { firestoreAdapter } from "./firestore-adapter.js";

runAdapterContract(() => firestoreAdapter("test-room"), {
  describe,
  expect,
  it,
});
```

### Rendering a diff view

```tsx
import { useEffect, useState } from "react";
import {
  diffIR,
  summarizeDiff,
  type IRDiff,
  type PageIR,
  type SnapshotAdapter,
} from "@anvilkit/plugin-version-history";
import { DiffView } from "@anvilkit/plugin-version-history/ui";

function HistoryEntry({
  adapter,
  fromId,
  toId,
}: {
  adapter: SnapshotAdapter;
  fromId: string;
  toId: string;
}) {
  const [diff, setDiff] = useState<IRDiff | null>(null);

  useEffect(() => {
    Promise.all([adapter.load(fromId), adapter.load(toId)]).then(([a, b]) => {
      setDiff(diffIR(a, b));
    });
  }, [adapter, fromId, toId]);

  if (!diff) return null;
  const summary = summarizeDiff(diff);
  return (
    <div>
      <p>{summary.description}</p>
      <DiffView diff={diff} />
    </div>
  );
}
```

## Notes & FAQ

### Storage is intentionally pluggable

The plugin never reads from `localStorage`, IndexedDB, or any backend directly. Adapters are the only persistence boundary — if you need session-shared, multi-tenant, or audit-compliant storage, write an adapter and stay inside the typed contract.

### `move-node` is informational

`applyDiff` validates `move-node` ops but does **not** perform reparenting on them alone. `change-children` on the affected parent is the authoritative reparenting/reorder signal. Consumers that inspect an `IRDiff` for display or logging may use `move-node` for presentation; do not rely on it for replay correctness.

### `maxSnapshots` requires `delete`

The FIFO eviction loop calls `adapter.delete(oldestId)` when the snapshot count would exceed the cap. Adapters that omit `delete` cannot satisfy `maxSnapshots`; either implement `delete` or omit `maxSnapshots`.

### Bundle budget

The published entry has an 8 KB gzipped budget enforced in CI by `scripts/check-bundle-budget.mjs` and `.size-limit.json`. Workspace deps (`@anvilkit/*`) and peers (`react`, `react-dom`, `@puckeditor/core`) are treated as external.

### Optional UI is opt-in by design

Importing from `@anvilkit/plugin-version-history` never pulls the `/ui` components — they live in a separate entry. This keeps the headless consumer (a CMS that only wants snapshots and audit history but ships its own UI) at the published bundle budget.

### Adapter freezing recommended

Reference adapters deep-freeze stored IRs to catch accidental mutation early. Custom adapters are not required to freeze, but doing so eliminates a class of "history snapshot mutated after save" bugs that are otherwise easy to miss.

### Cross-plugin types

`SnapshotAdapter`, `PeerInfo`, `PresenceState`, etc. are re-exported here as the source of truth — `@anvilkit/plugin-collab-yjs` extends `SnapshotAdapter` with `YjsSnapshotAdapter` to add conflict / status / metrics surfaces. Use this package's types when authoring shared abstractions across both plugins.
