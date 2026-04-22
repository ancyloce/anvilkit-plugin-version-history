import * as React from "react";

import { Button, Input, cn } from "@anvilkit/ui";

export interface SaveSnapshotButtonProps {
	readonly className?: string;
	readonly onSave: (label?: string) => Promise<void> | void;
}

export function SaveSnapshotButton({
	className,
	onSave,
}: SaveSnapshotButtonProps) {
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
					error instanceof Error ? error.message : "Unable to save snapshot.",
				);
			} finally {
				setIsSaving(false);
			}
		},
		[closeForm, label, onSave],
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
					Save snapshot
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
				Label
			</label>
			<Input
				autoFocus
				id={inputId}
				onChange={(event) => {
					setLabel(event.currentTarget.value);
				}}
				placeholder="Optional label"
				value={label}
			/>
			<div className="flex flex-wrap gap-2">
				<Button disabled={isSaving} type="submit">
					Save
				</Button>
				<Button
					disabled={isSaving}
					onClick={closeForm}
					type="button"
					variant="outline"
				>
					Cancel
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
