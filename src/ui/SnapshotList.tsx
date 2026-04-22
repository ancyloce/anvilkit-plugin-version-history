import * as React from "react";

import type { PageIR } from "@anvilkit/core/types";
import { Card, CardContent, CardHeader, CardTitle, cn } from "@anvilkit/ui";

import { diffIR, summarizeDiff } from "../diff.js";
import type { SnapshotMeta } from "../types.js";

export interface SnapshotListProps {
	readonly currentIR: PageIR;
	readonly loadSnapshot: (id: string) => Promise<PageIR>;
	readonly onOpen: (id: string) => void;
	readonly snapshots: readonly SnapshotMeta[];
}

export function SnapshotList({
	currentIR,
	loadSnapshot,
	onOpen,
	snapshots,
}: SnapshotListProps) {
	const itemRefs = React.useRef(new Map<string, HTMLDivElement>());

	const focusRelative = React.useCallback(
		(id: string, offset: number) => {
			const currentIndex = snapshots.findIndex((snapshot) => snapshot.id === id);
			if (currentIndex < 0) {
				return;
			}

			const nextSnapshot = snapshots[currentIndex + offset];
			if (!nextSnapshot) {
				return;
			}

			itemRefs.current.get(nextSnapshot.id)?.focus();
		},
		[snapshots],
	);

	return (
		<Card className="border border-border/70">
			<CardHeader className="border-b border-border/70">
				<CardTitle>Snapshots</CardTitle>
			</CardHeader>
			<CardContent className="pt-4">
				<div aria-label="Snapshots" className="flex flex-col gap-2" role="list">
					{snapshots.length === 0 ? (
						<p className="text-sm text-muted-foreground">No snapshots yet.</p>
					) : null}
					{snapshots.map((snapshot) => (
						<SnapshotRow
							currentIR={currentIR}
							focusRelative={focusRelative}
							key={snapshot.id}
							loadSnapshot={loadSnapshot}
							onOpen={onOpen}
							ref={(node) => {
								if (node) {
									itemRefs.current.set(snapshot.id, node);
									return;
								}

								itemRefs.current.delete(snapshot.id);
							}}
							snapshot={snapshot}
						/>
					))}
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

const SnapshotRow = React.forwardRef<HTMLDivElement, SnapshotRowProps>(
	function SnapshotRow(
		{ currentIR, focusRelative, loadSnapshot, onOpen, snapshot },
		forwardedRef,
	) {
		const [snapshotIR, setSnapshotIR] = React.useState<PageIR | null>(null);
		const [loadFailed, setLoadFailed] = React.useState(false);

		React.useEffect(() => {
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
		}, [loadSnapshot, snapshot.id]);

		const summary = React.useMemo(() => {
			if (loadFailed) {
				return "Unable to load snapshot.";
			}

			if (!snapshotIR) {
				return "Loading...";
			}

			return summarizeDiff(diffIR(currentIR, snapshotIR)).description;
		}, [currentIR, loadFailed, snapshotIR]);

		const displayLabel =
			snapshot.label?.trim().length ? snapshot.label.trim() : "Untitled snapshot";
		const savedAt = new Date(snapshot.savedAt).toLocaleString();

		return (
			<div
				aria-label={`${displayLabel}, saved ${savedAt}`}
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
				ref={forwardedRef}
				role="listitem"
				tabIndex={0}
			>
				<div className="flex flex-wrap items-start justify-between gap-2">
					<div className="font-medium text-foreground">{displayLabel}</div>
					<div className="text-sm text-muted-foreground">{savedAt}</div>
				</div>
				<p className="mt-2 text-sm text-muted-foreground">{summary}</p>
			</div>
		);
	},
);
