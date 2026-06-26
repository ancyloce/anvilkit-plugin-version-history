import * as React from "react";

import { useMsg } from "@anvilkit/core/i18n";
import type { PageIR } from "@anvilkit/core/types";
import { Card, CardContent } from "@anvilkit/ui";

import { hashPageIR } from "../utils/hash.js";
import { LruCache } from "../utils/lru.js";
import { checkRestoreConflict } from "../utils/restore.js";
import type { SnapshotAdapter, SnapshotMeta } from "../types/types.js";

/**
 * Cap on fully materialized `PageIR`s held in memory by the panel.
 * Mirrors the storage-side `maxSnapshots` intent (default 50) so the
 * in-memory load cache can never outgrow the retained history.
 */
const SNAPSHOT_CACHE_CAPACITY = 50;
import { SaveSnapshotButton } from "./SaveSnapshotButton.js";
import { SnapshotHistoryModal } from "./SnapshotHistoryModal.js";
import { SnapshotList } from "./SnapshotList.js";

/**
 * Payload handed to {@link VersionHistoryUIProps.onConflict} when a restore
 * is blocked because the live document drifted from the version it was
 * planned against.
 */
export interface RestoreConflictEvent {
  /** The snapshot the user tried to restore (metadata, may be `null`). */
  readonly snapshot: SnapshotMeta | null;
  /** The fully loaded snapshot IR, so the host can re-apply it to force. */
  readonly snapshotIR: PageIR;
  /** Hash of the live `currentIR` at the moment restore was attempted. */
  readonly currentHash: string;
  /** Hash captured when the snapshot was opened (the optimistic token). */
  readonly expectedBaseHash: string;
}

/**
 * Props for {@link VersionHistoryUI} — the self-contained panel that lists,
 * diffs, saves, and restores snapshots against the live document.
 */
export interface VersionHistoryUIProps {
  /**
   * Storage backend. The panel reads through it (`list`/`load`, plus
   * `subscribe` when present for collaborative refresh) and writes through it
   * (`save`); the host owns the adapter's lifecycle.
   */
  readonly adapter: SnapshotAdapter;
  /**
   * The live editor document. Saved as the new snapshot and used as the
   * "after" side of every diff. The host must keep this reactive to Puck
   * state (reading Puck in the host avoids the dual-`@puckeditor/core` hazard).
   */
  readonly currentIR: PageIR;
  /**
   * Apply a restored snapshot back to the editor (typically by dispatching
   * `setData(irToPuckData(ir))`). Invoked when the user confirms a restore
   * and no conflict is detected.
   */
  readonly onRestore: (ir: PageIR) => void;
  /**
   * Optional optimistic-concurrency guard. When supplied, the panel captures
   * the `currentIR` hash the moment a snapshot is opened and, on restore,
   * re-checks it against the live `currentIR`. If the document changed
   * underneath (a CONFLICT — e.g. a remote collaborator edited it), this is
   * invoked with the {@link RestoreConflictEvent} *instead of* `onRestore`,
   * letting the host warn the user or force the restore by calling
   * `onRestore(event.snapshotIR)` itself. Omitting it preserves the prior
   * restore-always behavior.
   */
  readonly onConflict?: (event: RestoreConflictEvent) => void;
}

/**
 * @example
 * ```tsx
 * <VersionHistoryUI
 * 	adapter={adapter}
 * 	currentIR={pageIR}
 * 	onRestore={(ir) => {
 * 		puckApi.dispatch({ type: "setData", data: irToPuckData(ir) });
 * 	}}
 * />
 * ```
 */
export function VersionHistoryUI({
  adapter,
  currentIR,
  onRestore,
  onConflict,
}: VersionHistoryUIProps) {
  const msg = useMsg();
  const snapshotCacheRef = React.useRef(
    new LruCache<string, PageIR>(SNAPSHOT_CACHE_CAPACITY),
  );
  // Optimistic-concurrency token: the `currentIR` hash captured when a
  // snapshot is opened. Re-checked at restore time so a document that
  // drifted underneath (collab/local edit) routes through `onConflict`
  // instead of silently clobbering the live work. Only populated when an
  // `onConflict` handler is wired — otherwise the restore path is untouched.
  const restoreBaseHashRef = React.useRef<string | null>(null);
  const isMountedRef = React.useRef(true);
  const [snapshots, setSnapshots] = React.useState<readonly SnapshotMeta[]>([]);
  const [listError, setListError] = React.useState<string | null>(null);
  const [selectedSnapshotId, setSelectedSnapshotId] = React.useState<
    string | null
  >(null);
  const [selectedSnapshotIR, setSelectedSnapshotIR] =
    React.useState<PageIR | null>(null);
  const [modalError, setModalError] = React.useState<string | null>(null);
  const [isRestoring, setIsRestoring] = React.useState(false);

  const loadSnapshot = React.useCallback(
    async (id: string) => {
      const cached = snapshotCacheRef.current.get(id);
      if (cached) {
        return cached;
      }

      const snapshot = await Promise.resolve(adapter.load(id));
      snapshotCacheRef.current.set(id, snapshot);
      return snapshot;
    },
    [adapter],
  );

  const refreshSnapshots = React.useCallback(async () => {
    try {
      const nextSnapshots = await Promise.resolve(adapter.list());
      setListError(null);
      React.startTransition(() => {
        setSnapshots(nextSnapshots);
      });
      return nextSnapshots;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : msg("versionHistory.error.loadList");
      setListError(message);
      throw error;
    }
  }, [adapter, msg]);

  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    snapshotCacheRef.current.clear();

    if (!adapter.subscribe) {
      return undefined;
    }

    // Collaborative adapters push remote updates; drop the cache and
    // re-list so the diff view never renders a stale snapshot.
    return adapter.subscribe(() => {
      snapshotCacheRef.current.clear();
      void refreshSnapshots().catch(() => {
        /* refreshSnapshots already surfaces listError */
      });
    });
  }, [adapter, refreshSnapshots]);

  React.useEffect(() => {
    let isActive = true;

    void refreshSnapshots().catch((error) => {
      if (!isActive) {
        return;
      }

      setListError(
        error instanceof Error
          ? error.message
          : msg("versionHistory.error.loadList"),
      );
    });

    return () => {
      isActive = false;
    };
  }, [msg, refreshSnapshots]);

  React.useEffect(() => {
    if (!selectedSnapshotId) {
      return undefined;
    }

    let isActive = true;
    setSelectedSnapshotIR(null);
    setModalError(null);

    void loadSnapshot(selectedSnapshotId)
      .then((snapshot) => {
        if (!isActive) {
          return;
        }

        setSelectedSnapshotIR(snapshot);
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }

        setModalError(
          error instanceof Error
            ? error.message
            : msg("versionHistory.error.open"),
        );
      });

    return () => {
      isActive = false;
    };
  }, [loadSnapshot, msg, selectedSnapshotId]);

  const selectedSnapshotMeta = React.useMemo(
    () =>
      selectedSnapshotId
        ? (snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ??
          null)
        : null,
    [selectedSnapshotId, snapshots],
  );

  const handleSave = React.useCallback(
    async (label?: string) => {
      const normalizedLabel = label?.trim();
      await Promise.resolve(
        adapter.save(currentIR, {
          ...(normalizedLabel ? { label: normalizedLabel } : {}),
          pageIRHash: hashPageIR(currentIR),
        }),
      );
      await refreshSnapshots();
    },
    [adapter, currentIR, refreshSnapshots],
  );

  const handleCloseModal = React.useCallback(() => {
    restoreBaseHashRef.current = null;
    setIsRestoring(false);
    setModalError(null);
    setSelectedSnapshotIR(null);
    setSelectedSnapshotId(null);
  }, []);

  const handleRestore = React.useCallback(async () => {
    if (!selectedSnapshotId) {
      return;
    }

    setIsRestoring(true);

    try {
      const snapshot =
        selectedSnapshotIR ?? (await loadSnapshot(selectedSnapshotId));

      // Optimistic-concurrency guard (opt-in). If the live document drifted
      // from the hash captured when the snapshot was opened, route to the
      // host's `onConflict` instead of clobbering it; the host can force by
      // calling `onRestore(event.snapshotIR)`.
      const expectedBaseHash = restoreBaseHashRef.current;
      if (onConflict && expectedBaseHash !== null) {
        const { hasConflict, currentHash } = checkRestoreConflict({
          currentIR,
          expectedBaseHash,
        });
        if (hasConflict) {
          onConflict({
            snapshot: selectedSnapshotMeta,
            snapshotIR: snapshot,
            currentHash,
            expectedBaseHash,
          });
          handleCloseModal();
          return;
        }
      }

      onRestore(snapshot);
      handleCloseModal();
    } catch (error) {
      if (isMountedRef.current) {
        setModalError(
          error instanceof Error
            ? error.message
            : msg("versionHistory.error.restore"),
        );
      }
    } finally {
      if (isMountedRef.current) {
        setIsRestoring(false);
      }
    }
  }, [
    currentIR,
    handleCloseModal,
    loadSnapshot,
    msg,
    onConflict,
    onRestore,
    selectedSnapshotIR,
    selectedSnapshotId,
    selectedSnapshotMeta,
  ]);

  return (
    <div className="flex flex-col gap-4">
      <SaveSnapshotButton onSave={handleSave} />
      {listError ? (
        <Card
          className="border border-destructive/20 bg-destructive/5"
          size="sm"
        >
          <CardContent className="pt-3">
            <p className="text-sm text-destructive" role="alert">
              {listError}
            </p>
          </CardContent>
        </Card>
      ) : null}
      <SnapshotList
        currentIR={currentIR}
        loadSnapshot={loadSnapshot}
        onOpen={(id) => {
          // Capture the optimistic-concurrency token at open time (only
          // when a conflict handler is wired, to skip the hash otherwise).
          restoreBaseHashRef.current = onConflict
            ? hashPageIR(currentIR)
            : null;
          setSelectedSnapshotId(id);
        }}
        snapshots={snapshots}
      />
      <SnapshotHistoryModal
        after={currentIR}
        before={selectedSnapshotIR}
        error={modalError}
        onClose={handleCloseModal}
        onRestore={handleRestore}
        open={selectedSnapshotId !== null}
        restoreDisabled={isRestoring || selectedSnapshotIR === null}
        snapshot={selectedSnapshotMeta}
      />
    </div>
  );
}
