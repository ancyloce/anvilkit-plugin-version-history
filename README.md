# @anvilkit/plugin-version-history

> **Alpha (`0.1.7`).** Header actions and the diff/apply engine are stable. The plugin can also contribute the StudioSidebar `history` panel through the supported `ctx.registerHistoryPanel` slot — pass the `renderPanel` option (see [Sidebar history panel](#sidebar-history-panel)).

Headless version-history plugin for Anvilkit Studio. Snapshot persistence is delegated to a host-provided `SnapshotAdapter`, so the plugin itself ships no I/O — only the diff/apply engine, header actions, optional UI primitives, and reference adapters for tests and demos.

## Installation

```bash
pnpm add @anvilkit/plugin-version-history react react-dom @puckeditor/core
```

Non-optional peers: `react >=19.0.0`, `react-dom >=19.0.0`, `@puckeditor/core ^0.22.0`. No transport or storage dependencies — the host owns persistence end-to-end.

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

- **Adapter-driven persistence** — the plugin defines the contract; the host implements `save` / `list` / `load` / `delete?` (plus optional `deleteMany?` / `exportAll?` / `importAll?` for batch cleanup and portability) and gets full control over storage (in-memory, localStorage, Firestore, S3, …).
- **Deterministic diff/apply engine** — `diffIR(a, b)` produces a frozen `IRDiff`; `applyDiff(a, diff)` round-trips.
- **Optional UI** — five components on `/ui` for hosts that want batteries-included version history. The default export imports none of them, so headless consumers pay no UI rendering cost.
- **FIFO eviction** — `maxSnapshots` automatically deletes the oldest snapshot when capacity is reached (requires `adapter.delete`).
- **Reference adapters** — `inMemoryAdapter()` for tests, `localStorageAdapter({ namespace })` for demos.
- **Adapter test suite** — `runAdapterContract` is the same contract the reference adapters use; consumers can validate their own implementation against it.
- **Bundle budget** — ~10 KB gzipped entry chunk enforced in CI via `scripts/check-bundle-budget.mjs`.

## API reference

### Factory

```ts
function createVersionHistoryPlugin(
  options: CreateVersionHistoryPluginOptions,
): StudioPlugin;

interface CreateVersionHistoryPluginOptions {
  readonly adapter: SnapshotAdapter;
  readonly maxSnapshots?: number;
  /** Puck `Data` → `PageIR` bridge so "Save snapshot" works in a real `<Studio>` session. */
  readonly buildIR?: (data: unknown) => PageIR | null | Promise<PageIR | null>;
  /** Render the StudioSidebar `history` panel body — see below. */
  readonly renderPanel?: () => ReactNode;
}
```

Returns a typed `StudioPlugin` carrying the `VersionHistoryContribution` capability (so downstream consumers can recover `adapter` / `snapshots` via `InferPluginContributions`).

### Sidebar history panel

Pass `renderPanel` to contribute the StudioSidebar `history` module body. The plugin registers a `StudioHistoryPanel` through core's supported, rendered `ctx.registerHistoryPanel` slot during `register()`; this makes the `history` rail tab appear (`SidebarRail` gates it on `historyPanel !== null`) and renders your thunk inside the panel via core's `HistoryModule`. The runtime auto-tears-down the registration on `<Studio>` unmount. Omitting `renderPanel` keeps the prior header-actions-only behavior — no sidebar panel, no rail tab.

```tsx
import { createVersionHistoryPlugin } from "@anvilkit/plugin-version-history";
import { VersionHistoryUI } from "@anvilkit/plugin-version-history/ui";

const plugin = createVersionHistoryPlugin({
  adapter,
  renderPanel: () => (
    <VersionHistoryUI
      adapter={adapter}
      currentIR={currentIR}
      onRestore={(ir) => puckApi.dispatch({ type: "setData", data: irToPuckData(ir) })}
    />
  ),
});
```

The host owns the `currentIR` read and `onRestore` dispatch: a plugin submodule may resolve its own `@puckeditor/core` copy at runtime (the dual-puck hazard), so reading reactive Puck state must happen in the host's React/Puck context. `currentIR` typically comes from `puckDataToIR(data, puckConfig)` (`@anvilkit/ir`) against the host's reactive Puck data.

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
  deleteMany?(ids: readonly string[]): MaybePromise<void>;
  exportAll?(): MaybePromise<VersionHistoryExport>;
  importAll?(
    data: VersionHistoryExport,
    options?: { mode?: "replace" | "merge" },
  ): MaybePromise<void>;
  subscribe?(onUpdate: (ir: PageIR, peer?: PeerInfo) => void): Unsubscribe;
  presence?: SnapshotAdapterPresence;
}
```

| Method            | Required? | Purpose                                                                   |
| ----------------- | --------- | ------------------------------------------------------------------------- |
| `save(ir, meta)`  | yes       | Persist a `PageIR`. Returns a unique snapshot id.                         |
| `list()`          | yes       | Return all snapshots in order (newest-first by convention).               |
| `load(id)`        | yes       | Hydrate by id. Throw `VersionHistoryError("SNAPSHOT_NOT_FOUND")` on miss. |
| `delete(id)`      | optional  | Required when `maxSnapshots` is set.                                      |
| `deleteMany(ids)` | optional  | Batch delete for admin cleanup; leaves the remaining snapshots loadable.  |
| `exportAll()`     | optional  | Materialize all snapshots as a portable `VersionHistoryExport` archive.   |
| `importAll(data)` | optional  | Restore from a `VersionHistoryExport` (`"merge"` default, or `"replace"`).|
| `subscribe(cb)`   | optional  | Push updates from collaborative adapters (e.g., `createYjsAdapter`).      |
| `presence`        | optional  | Multi-user cursor / selection channel. Implemented by the Yjs adapter.    |

All methods may be sync or async (`MaybePromise<T>`). Frozen, structurally-equal results are recommended.

#### Batch delete & portability

`deleteMany`, `exportAll`, and `importAll` are additive, optional, and backward
compatible — adapters that omit them are unaffected, and callers must
feature-detect them. The in-memory and `localStorage` reference adapters
implement all three; the header `maxSnapshots` retention path automatically
prefers `deleteMany` when present.

```ts
const archive = await adapter.exportAll?.(); // { version: 1; snapshots: [{ meta, ir }] }

// Round-trips into a fresh adapter: imported snapshots keep their original
// ids/metadata and are stored as standalone keyframes, so each is loadable.
await fresh.importAll?.(archive, { mode: "replace" }); // or "merge" (default)
```

`exportAll` reconstructs each snapshot's **full** `PageIR` from the internal
delta chain, so the archive is self-contained and JSON-serializable (it is _not_
the delta-chain wire format). `normalizeVersionHistoryExport(value)` is the
exported, side-effect-free validator the adapters use to reject a malformed
archive with a `STORAGE_CORRUPT` `VersionHistoryError` before any mutation —
call it directly to validate hand-built or third-party archives.

#### Collaboration: `subscribe` & `presence` (host-owned)

`subscribe` and `presence` are **optional and owned by the host / a
collaborative adapter — they are not provided by the bundled reference
adapters.** The in-memory and `localStorage` reference adapters are single-user
and intentionally do not implement either one (the `types.contract.test.ts`
suite asserts both are `undefined` on them), so callers must feature-detect
them before use.

A real implementation lives in a collaboration transport — e.g. the Yjs adapter
`@anvilkit/plugin-collab-yjs` (`YjsSnapshotAdapter`), which layers `subscribe`
(remote-change push) and `presence` (live cursors / selections) on top of this
contract. When present:

- `subscribe(onUpdate)` fires `onUpdate(ir, peer?)` whenever a remote peer
  mutates the shared document and returns an `Unsubscribe` you call to stop
  receiving updates (idempotent).
- `presence` exposes `update(state)` to publish the local peer and
  `onPeerChange(cb)` to observe the remote roster (see `SnapshotAdapterPresence`).

If you are writing your own collaborative adapter, implement these two members;
if you only need single-user persistence, omit them and the plugin degrades to
header-action snapshots with no live sync.

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
  | "CONFLICT" // optimistic-concurrency: doc changed under a planned restore
  | "PERMISSION_DENIED" // host/adapter rejected the op on authorization grounds
  | "SNAPSHOT_NOT_FOUND"
  | "STORAGE_CORRUPT"
  | "STORAGE_QUOTA_EXCEEDED"
  | "STORAGE_UNAVAILABLE";
```

Remote and collaborative adapters reject unauthorized `save`/`load`/`list`/`delete`/`restore` calls by throwing a `PERMISSION_DENIED` error. Use the `createPermissionDeniedError(operation, detail?)` convenience constructor, or throw `new VersionHistoryError("PERMISSION_DENIED", message)` directly:

```ts
import { createPermissionDeniedError } from "@anvilkit/plugin-version-history";

async function load(id: string) {
  if (!viewer.canRead(roomId)) {
    throw createPermissionDeniedError("load", `viewer ${viewer.id} lacks read access`);
  }
  // …
}
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

The FIFO eviction path removes the oldest snapshots when the count would exceed the cap — preferring `adapter.deleteMany(ids)` (a single store mutation) and falling back to per-id `adapter.delete(oldestId)`. Adapters that omit both `deleteMany` and `delete` cannot satisfy `maxSnapshots`; either implement one of them or omit `maxSnapshots`.

### Bundle budget

The published entry chunk has a ~10 KB gzipped budget enforced in CI by `scripts/check-bundle-budget.mjs`, with a complementary `.size-limit.json` budget on `dist/index.js`. Workspace deps (`@anvilkit/*`) and peers (`react`, `react-dom`, `@puckeditor/core`) are treated as external.

### Optional UI is opt-in by design

Importing from `@anvilkit/plugin-version-history` never pulls the `/ui` components — they live in a separate entry. This keeps the headless consumer (a CMS that only wants snapshots and audit history but ships its own UI) at the published bundle budget.

### Adapter freezing recommended

Reference adapters deep-freeze stored IRs to catch accidental mutation early. Custom adapters are not required to freeze, but doing so eliminates a class of "history snapshot mutated after save" bugs that are otherwise easy to miss.

### Cross-plugin types

`SnapshotAdapter`, `PeerInfo`, `PresenceState`, etc. are re-exported here as the source of truth — `@anvilkit/plugin-collab-yjs` extends `SnapshotAdapter` with `YjsSnapshotAdapter` to add conflict / status / metrics surfaces. Use this package's types when authoring shared abstractions across both plugins.
