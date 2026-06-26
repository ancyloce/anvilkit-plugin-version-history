import * as React from "react";

import { useMsg } from "@anvilkit/core/i18n";
import type { PageIR } from "@anvilkit/core/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@anvilkit/ui";

import type { SnapshotMeta } from "../types/types.js";
import { DiffView } from "./DiffView.js";
import { useFormattedTimestamp } from "./use-formatted-timestamp.js";

/** Props for {@link SnapshotHistoryModal}. */
export interface SnapshotHistoryModalProps {
  /** The live document — the "after" side of the diff. */
  readonly after: PageIR;
  /**
   * The opened snapshot's IR — the "before" side. `null` while it is still
   * loading, which renders a loading placeholder and disables restore.
   */
  readonly before: PageIR | null;
  /** Inline error to surface in the dialog (e.g. a failed load or restore). */
  readonly error?: string | null;
  /** Close the dialog (also fired on Escape / overlay dismiss). */
  readonly onClose: () => void;
  /** Confirm restoring the opened snapshot. May be async. */
  readonly onRestore: () => Promise<void> | void;
  /** Controls the dialog's open state. */
  readonly open: boolean;
  /**
   * Disables the restore button independently of `before` (e.g. while a
   * restore is already in flight). Restore is also disabled whenever
   * `before` is `null`.
   */
  readonly restoreDisabled?: boolean;
  /**
   * Metadata of the opened snapshot, used for the dialog's title and saved-at
   * timestamp. `null`/omitted falls back to generic labels.
   */
  readonly snapshot?: SnapshotMeta | null;
}

/**
 * Snapshot diff + restore dialog.
 *
 * Built on the shared `@anvilkit/ui` Dialog (Base UI), which provides the
 * focus trap, scroll lock, Escape handling, and focus restoration the
 * previous hand-rolled overlay lacked. The public prop contract is
 * unchanged; `open`/`onClose` map onto the controlled Dialog.
 */
export function SnapshotHistoryModal({
  after,
  before,
  error,
  onClose,
  onRestore,
  open,
  restoreDisabled = false,
  snapshot,
}: SnapshotHistoryModalProps) {
  const msg = useMsg();
  const displayLabel = snapshot?.label?.trim().length
    ? snapshot.label.trim()
    : msg("versionHistory.modal.details");
  const savedAt = useFormattedTimestamp(snapshot?.savedAt ?? "");

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90vh] w-full max-w-5xl overflow-auto">
        <DialogHeader>
          <DialogTitle>{displayLabel}</DialogTitle>
          <DialogDescription>
            {savedAt
              ? msg("versionHistory.modal.savedAt").replace("{time}", savedAt)
              : msg("versionHistory.modal.title")}
          </DialogDescription>
        </DialogHeader>
        {before ? (
          <DiffView after={after} before={before} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {msg("versionHistory.modal.loading")}
          </p>
        )}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">
            {msg("versionHistory.button.close")}
          </Button>
          <Button
            disabled={restoreDisabled || before === null}
            onClick={() => {
              void onRestore();
            }}
            type="button"
          >
            {msg("versionHistory.button.restore")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
