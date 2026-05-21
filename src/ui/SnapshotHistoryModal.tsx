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

export interface SnapshotHistoryModalProps {
  readonly after: PageIR;
  readonly before: PageIR | null;
  readonly error?: string | null;
  readonly onClose: () => void;
  readonly onRestore: () => Promise<void> | void;
  readonly open: boolean;
  readonly restoreDisabled?: boolean;
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
  const displayLabel = snapshot?.label?.trim().length
    ? snapshot.label.trim()
    : "Snapshot details";
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
            {savedAt ? `Saved ${savedAt}` : "Snapshot history"}
          </DialogDescription>
        </DialogHeader>
        {before ? (
          <DiffView after={after} before={before} />
        ) : (
          <p className="text-sm text-muted-foreground">Loading snapshot...</p>
        )}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">
            Close
          </Button>
          <Button
            disabled={restoreDisabled || before === null}
            onClick={() => {
              void onRestore();
            }}
            type="button"
          >
            Restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
