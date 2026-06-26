import * as React from "react";

import { useMsg } from "@anvilkit/core/i18n";
import { Button, Input, cn } from "@anvilkit/ui";

/** Props for {@link SaveSnapshotButton}. */
export interface SaveSnapshotButtonProps {
  /** Optional class applied to the button's (or expanded form's) wrapper. */
  readonly className?: string;
  /**
   * Persist a new snapshot. Receives the trimmed label, or `undefined` when
   * the field was left blank. May be async; a rejection is surfaced inline as
   * the form's error message and keeps the form open. The button manages its
   * own open/saving state — the host only persists.
   */
  readonly onSave: (label?: string) => Promise<void> | void;
}

export function SaveSnapshotButton({
  className,
  onSave,
}: SaveSnapshotButtonProps) {
  const msg = useMsg();
  const inputId = React.useId();
  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const closeForm = React.useCallback(() => {
    setErrorMessage(null);
    setIsFormOpen(false);
    setLabel("");
  }, []);

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrorMessage(null);
      setIsSaving(true);

      try {
        const nextLabel = label.trim();
        await onSave(nextLabel.length > 0 ? nextLabel : undefined);
        closeForm();
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : msg("versionHistory.save.error"),
        );
      } finally {
        setIsSaving(false);
      }
    },
    [closeForm, label, msg, onSave],
  );

  if (!isFormOpen) {
    return (
      <div className={className}>
        <Button
          onClick={() => {
            setErrorMessage(null);
            setIsFormOpen(true);
          }}
          type="button"
        >
          {msg("versionHistory.action.save")}
        </Button>
      </div>
    );
  }

  return (
    <form
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-border bg-card p-3",
        className,
      )}
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
    >
      <label className="text-sm font-medium" htmlFor={inputId}>
        {msg("versionHistory.save.label")}
      </label>
      <Input
        autoFocus
        id={inputId}
        onChange={(event) => {
          setLabel(event.currentTarget.value);
        }}
        placeholder={msg("versionHistory.save.placeholder")}
        value={label}
      />
      <div className="flex flex-wrap gap-2">
        <Button disabled={isSaving} type="submit">
          {msg("versionHistory.button.save")}
        </Button>
        <Button
          disabled={isSaving}
          onClick={closeForm}
          type="button"
          variant="outline"
        >
          {msg("versionHistory.button.cancel")}
        </Button>
      </div>
      {errorMessage ? (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </form>
  );
}
