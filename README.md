# @anvilkit/plugin-version-history

Headless version-history plugin for Anvilkit Studio.

Snapshot persistence is delegated to a host-provided `SnapshotAdapter`, so the
plugin itself ships no I/O — only the diff/apply engine, header actions,
optional UI primitives, and reference adapters for tests and demos.

## Install

```bash
pnpm add @anvilkit/plugin-version-history
```

Peer deps: `react ^18 || ^19`, `react-dom ^18 || ^19`, `@puckeditor/core ^0.19`.

## Usage

```ts
import { createVersionHistoryPlugin, inMemoryAdapter } from "@anvilkit/plugin-version-history";

const plugin = createVersionHistoryPlugin({
	adapter: inMemoryAdapter(),
	maxSnapshots: 50, // optional FIFO cap
});
```

`createVersionHistoryPlugin` returns a `StudioPlugin`. Pass the result to
`compilePlugins(...)` (or whichever Studio composition you use). The plugin
contributes two header actions today (`version-history:save` and
`version-history:open`) and emits `version-history:save-requested` /
`version-history:open-requested` on the Studio event bus.

## Adapter contract

A `SnapshotAdapter` implements:

| Method | Purpose |
| --- | --- |
| `save(ir, meta) → string` | Persist a `PageIR`, return the snapshot id |
| `list() → SnapshotMeta[]` | Return all known snapshots (order-preserving) |
| `load(id) → PageIR` | Hydrate a snapshot by id (throws `VersionHistoryError("SNAPSHOT_NOT_FOUND")`) |
| `delete?(id) → void` | Optional — required for `maxSnapshots` eviction |

All methods may be sync or async (`MaybePromise<T>`). Frozen, structurally-equal
results are recommended.

## Reference adapters

- `inMemoryAdapter()` — for tests; deep-freezes stored IRs.
- `localStorageAdapter({ namespace })` — for demos; persists each snapshot under
  `<namespace>:snapshots:<id>` plus a `<namespace>:snapshots:index` array.
  Throws `VersionHistoryError` with codes `STORAGE_UNAVAILABLE`,
  `STORAGE_CORRUPT`, or `STORAGE_QUOTA_EXCEEDED` on the relevant failure modes.

## Testing your own adapter

The `@anvilkit/plugin-version-history/testing` subpath exports
`runAdapterContract`, the same suite the reference adapters use:

```ts
import { runAdapterContract } from "@anvilkit/plugin-version-history/testing";
import { describe, expect, it } from "vitest";

import { myAdapter } from "./my-adapter.js";

runAdapterContract(() => myAdapter(), { describe, expect, it });
```

## Optional UI

The `@anvilkit/plugin-version-history/ui` subpath ships React components
(`VersionHistoryUI`, `SaveSnapshotButton`, `SnapshotList`, `SnapshotHistoryModal`,
`DiffView`) that consume an adapter directly. They are entirely optional — the
default plugin export does not import them, so consumers who only need the
header actions and adapter wiring pay no UI rendering cost.

## Diff / apply engine

`diffIR(a, b)` produces a deterministic, frozen `IRDiff`. `applyDiff(a, diff)`
round-trips: `applyDiff(a, diffIR(a, b))` is structurally equal to `b`.
`summarizeDiff(diff)` returns a small `{ added, removed, moved, changed,
description }` summary suitable for UI labels.

`move-node` ops are informational hints. `change-children` on the affected
parent(s) is the authoritative reparenting/reorder signal — `applyDiff`
does not reparent on `move-node` alone.

## Bundle budget

The published entry has an 8 KB gzipped budget enforced in CI by
`scripts/check-bundle-budget.mjs` (and `.size-limit.json`). Workspace deps
(`@anvilkit/*`) and peers (`react`, `react-dom`, `@puckeditor/core`) are
treated as external.

## Status

Phase5-011 scaffold. Header actions are wired today; the sidebar-panel slot
contribution is deferred to phase5-013 once `StudioPluginContext` exposes the
sidebar registration API.
