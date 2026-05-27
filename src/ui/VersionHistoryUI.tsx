import * as React from "react";

import type { PageIR } from "@anvilkit/core/types";
import { Card, CardContent } from "@anvilkit/ui";

import { hashPageIR } from "../utils/hash.js";
import { LruCache } from "../utils/lru.js";
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

export interface VersionHistoryUIProps {
  readonly adapter: SnapshotAdapter;
  readonly currentIR: PageIR;
  readonly onRestore: (ir: PageIR) => void;
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
}: VersionHistoryUIProps) {
  const snapshotCacheRef = React.useRef(
    new LruCache<string, PageIR>(SNAPSHOT_CACHE_CAPACITY),
  );
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
        error instanceof Error ? error.message : "Unable to load snapshots.";
      setListError(message);
      throw error;
    }
  }, [adapter]);

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
        error instanceof Error ? error.message : "Unable to load snapshots.",
      );
    });

    return () => {
      isActive = false;
    };
  }, [refreshSnapshots]);

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
          error instanceof Error ? error.message : "Unable to open snapshot.",
        );
      });

    return () => {
      isActive = false;
    };
  }, [loadSnapshot, selectedSnapshotId]);

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
      onRestore(snapshot);
      handleCloseModal();
    } catch (error) {
      if (isMountedRef.current) {
        setModalError(
          error instanceof Error
            ? error.message
            : "Unable to restore snapshot.",
        );
      }
    } finally {
      if (isMountedRef.current) {
        setIsRestoring(false);
      }
    }
  }, [
    handleCloseModal,
    loadSnapshot,
    onRestore,
    selectedSnapshotIR,
    selectedSnapshotId,
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
