# @anvilkit/plugin-version-history

Headless version-history plugin for Anvilkit Studio.

## What It Ships

- `createVersionHistoryPlugin({ adapter, maxSnapshots })`
- `inMemoryAdapter()` for tests
- `localStorageAdapter({ namespace })` for demos
- `@anvilkit/plugin-version-history/testing` with `runAdapterContract()`

## Status

This package is the phase5-011 scaffold. It contributes header actions
today and defers the sidebar-panel slot wiring to phase5-013 once Core
adds the sidebar registration API.
