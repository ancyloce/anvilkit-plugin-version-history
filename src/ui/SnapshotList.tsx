import * as React from "react";

import { useMsg } from "@anvilkit/core/i18n";
import type { PageIR, PageIRNode } from "@anvilkit/core/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Windowed,
  cn,
} from "@anvilkit/ui";

import { diffIR, summarizeDiff } from "../utils/diff.js";
import type { SnapshotMeta } from "../types/types.js";
import { formatSummaryDescription } from "./format-summary.js";
import { useFormattedTimestamp } from "./use-formatted-timestamp.js";

function hasLockedNode(node: PageIRNode): boolean {
  if (node.meta?.locked === true) {
    return true;
  }
  for (const child of node.children ?? []) {
    if (hasLockedNode(child)) {
      return true;
    }
  }
  return false;
}

/**
 * Estimated rendered height of one {@link SnapshotRow} in px. Only used to
 * seed the virtualizer's window math once the list crosses the windowing
 * threshold; the live row height is measured after layout.
 */
const SNAPSHOT_ROW_ESTIMATE_PX = 84;

/** Props for {@link SnapshotList}. */
export interface SnapshotListProps {
  /**
   * The live document each row diffs against to compute its lazy change
   * summary (e.g. "3 changes: 2 added, 1 removed").
   */
  readonly currentIR: PageIR;
  /**
   * Resolve a snapshot's full `PageIR` by id. Called lazily — only once a row
   * scrolls into view (or immediately when `IntersectionObserver` is absent,
   * e.g. SSR/jsdom).
   */
  readonly loadSnapshot: (id: string) => Promise<PageIR>;
  /** Invoked with a snapshot's id when its row is activated (click/Enter). */
  readonly onOpen: (id: string) => void;
  /** Snapshot metadata to render, in display order (newest-first by host). */
  readonly snapshots: readonly SnapshotMeta[];
}

export function SnapshotList({
  currentIR,
  loadSnapshot,
  onOpen,
  snapshots,
}: SnapshotListProps) {
  const msg = useMsg();
  const itemRefs = React.useRef(new Map<string, HTMLDivElement>());
  // When a roving-focus move targets a row that the virtualizer has not
  // mounted yet (it's outside the visible window), we bump `activeIndex` to
  // scroll it into view via `Windowed` and stash its id here. The row's ref
  // callback focuses it the instant it mounts, so arrow-key navigation can
  // still reach every snapshot in a large, windowed history.
  const pendingFocusId = React.useRef<string | null>(null);
  const [activeIndex, setActiveIndex] = React.useState<number | undefined>(
    undefined,
  );

  const focusRelative = React.useCallback(
    (id: string, offset: number) => {
      const currentIndex = snapshots.findIndex(
        (snapshot) => snapshot.id === id,
      );
      if (currentIndex < 0) {
        return;
      }

      const nextIndex = currentIndex + offset;
      const nextSnapshot = snapshots[nextIndex];
      if (!nextSnapshot) {
        return;
      }

      const mounted = itemRefs.current.get(nextSnapshot.id);
      if (mounted) {
        mounted.focus();
        return;
      }

      // Off-window: scroll the target into view, then focus on mount.
      pendingFocusId.current = nextSnapshot.id;
      setActiveIndex(nextIndex);
    },
    [snapshots],
  );

  // Stable per the `Windowed` contract — an inline `renderItem` would
  // re-render every row on each parent render and defeat windowing.
  const renderRow = React.useCallback(
    (snapshot: SnapshotMeta) => (
      <SnapshotRow
        currentIR={currentIR}
        focusRelative={focusRelative}
        loadSnapshot={loadSnapshot}
        onOpen={onOpen}
        ref={(node) => {
          if (node) {
            itemRefs.current.set(snapshot.id, node);
            if (pendingFocusId.current === snapshot.id) {
              pendingFocusId.current = null;
              node.focus();
            }
            return;
          }

          itemRefs.current.delete(snapshot.id);
        }}
        snapshot={snapshot}
      />
    ),
    [currentIR, focusRelative, loadSnapshot, onOpen],
  );

  const getRowKey = React.useCallback(
    (snapshot: SnapshotMeta) => snapshot.id,
    [],
  );

  return (
    <Card className="border border-border/70">
      <CardHeader className="border-b border-border/70">
        <CardTitle>{msg("versionHistory.list.title")}</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <div
          aria-label={msg("versionHistory.list.title")}
          className="flex flex-col gap-2"
          role="list"
        >
          {snapshots.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {msg("versionHistory.list.empty")}
            </p>
          ) : (
            // Below `Windowed`'s threshold this emits the rows directly
            // (identical DOM to a `.map()`); above it, only the visible
            // window + overscan mount, capping DOM cost for huge histories.
            <Windowed
              activeIndex={activeIndex}
              estimateSize={SNAPSHOT_ROW_ESTIMATE_PX}
              itemKey={getRowKey}
              items={snapshots}
              renderItem={renderRow}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface SnapshotRowProps {
  readonly currentIR: PageIR;
  readonly focusRelative: (id: string, offset: number) => void;
  readonly loadSnapshot: (id: string) => Promise<PageIR>;
  readonly onOpen: (id: string) => void;
  readonly snapshot: SnapshotMeta;
}

function SnapshotRow({
  currentIR,
  focusRelative,
  loadSnapshot,
  onOpen,
  snapshot,
  ref: forwardedRef,
}: SnapshotRowProps & { ref?: React.Ref<HTMLDivElement> }) {
    const msg = useMsg();
    const [snapshotIR, setSnapshotIR] = React.useState<PageIR | null>(null);
    const [loadFailed, setLoadFailed] = React.useState(false);
    const rowRef = React.useRef<HTMLDivElement | null>(null);

    // Merge our local ref (needed for the IntersectionObserver below) with
    // the parent's forwarded ref (used for roving-focus keyboard nav).
    const setRowRef = React.useCallback(
      (node: HTMLDivElement | null) => {
        rowRef.current = node;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          forwardedRef.current = node;
        }
      },
      [forwardedRef],
    );

    // Defer the snapshot load + `O(node-count)` diff until the row is
    // actually scrolled into view. Opening the panel with K snapshots
    // previously deserialized K full PageIRs and ran K diffs eagerly on
    // mount (O(K·N), the whole list up front). When IntersectionObserver
    // is unavailable (jsdom / SSR / legacy) we fall back to loading
    // immediately, preserving the old eager behavior.
    const [shouldLoad, setShouldLoad] = React.useState(
      () => typeof IntersectionObserver === "undefined",
    );

    React.useEffect(() => {
      if (shouldLoad || typeof IntersectionObserver === "undefined") {
        return undefined;
      }
      const node = rowRef.current;
      if (!node) {
        return undefined;
      }
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
        }
      });
      observer.observe(node);
      return () => {
        observer.disconnect();
      };
    }, [shouldLoad]);

    React.useEffect(() => {
      if (!shouldLoad) {
        return undefined;
      }
      let isActive = true;

      void loadSnapshot(snapshot.id)
        .then((ir) => {
          if (!isActive) {
            return;
          }

          setSnapshotIR(ir);
          setLoadFailed(false);
        })
        .catch(() => {
          if (!isActive) {
            return;
          }

          setLoadFailed(true);
        });

      return () => {
        isActive = false;
      };
    }, [shouldLoad, loadSnapshot, snapshot.id]);

    const summary = React.useMemo(() => {
      if (loadFailed) {
        return msg("versionHistory.list.loadError");
      }

      if (!snapshotIR) {
        return msg("versionHistory.list.loading");
      }

      return formatSummaryDescription(
        summarizeDiff(diffIR(currentIR, snapshotIR)),
        msg,
      );
    }, [currentIR, loadFailed, msg, snapshotIR]);

    const isLocked = React.useMemo(
      () => (snapshotIR ? hasLockedNode(snapshotIR.root) : false),
      [snapshotIR],
    );

    const displayLabel = snapshot.label?.trim().length
      ? snapshot.label.trim()
      : msg("versionHistory.list.untitled");
    const savedAt = useFormattedTimestamp(snapshot.savedAt);

    return (
      <div
        aria-label={msg("versionHistory.list.rowAria")
          .replace("{label}", displayLabel)
          .replace("{time}", savedAt)}
        className={cn(
          "cursor-pointer rounded-xl border border-border bg-background px-3 py-3 outline-none transition-colors",
          "hover:border-foreground/20 hover:bg-muted/40",
          "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
        )}
        onClick={() => {
          onOpen(snapshot.id);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            focusRelative(snapshot.id, 1);
            return;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            focusRelative(snapshot.id, -1);
            return;
          }

          if (event.key === "Enter") {
            event.preventDefault();
            onOpen(snapshot.id);
          }
        }}
        ref={setRowRef}
        role="listitem"
        tabIndex={0}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2 font-medium text-foreground">
            {displayLabel}
            {isLocked ? (
              <span
                aria-label={msg("versionHistory.list.lockedAria")}
                className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900"
                title={msg("versionHistory.list.lockedTitle")}
              >
                {msg("versionHistory.list.lockedBadge")}
              </span>
            ) : null}
          </div>
          <time
            className="text-sm text-muted-foreground"
            dateTime={snapshot.savedAt}
          >
            {savedAt}
          </time>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{summary}</p>
      </div>
    );
}
