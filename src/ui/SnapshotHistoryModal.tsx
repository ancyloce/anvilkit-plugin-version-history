import * as React from "react";

import type { PageIR } from "@anvilkit/core/types";
import {
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@anvilkit/ui";

import type { SnapshotMeta } from "../types.js";
import { DiffView } from "./DiffView.js";

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
	const titleId = React.useId();

	React.useEffect(() => {
		if (!open) {
			return undefined;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}

			event.preventDefault();
			onClose();
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [onClose, open]);

	if (!open) {
		return null;
	}

	const displayLabel =
		snapshot?.label?.trim().length ? snapshot.label.trim() : "Snapshot details";
	const savedAt = snapshot ? new Date(snapshot.savedAt).toLocaleString() : null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
			onClick={onClose}
		>
			<div
				aria-labelledby={titleId}
				aria-modal="true"
				className="max-h-[90vh] w-full max-w-5xl overflow-auto"
				onClick={(event) => {
					event.stopPropagation();
				}}
				role="dialog"
			>
				<Card className="border border-border bg-background shadow-xl">
					<CardHeader className="border-b border-border/70">
						<CardTitle id={titleId}>{displayLabel}</CardTitle>
						<CardDescription>
							{savedAt ? `Saved ${savedAt}` : "Snapshot history"}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4 pt-4">
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
						<div className="flex flex-wrap justify-end gap-2">
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
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
