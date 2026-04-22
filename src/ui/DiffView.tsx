import * as React from "react";

import type { PageIR } from "@anvilkit/core/types";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	cn,
} from "@anvilkit/ui";

import type { IRDiff, IRDiffOp } from "../diff.js";
import { diffIR, summarizeDiff } from "../diff.js";

export interface DiffViewProps {
	readonly after: PageIR;
	readonly before: PageIR;
}

interface DiffEntry {
	readonly detail: string;
	readonly label: string;
	readonly title: string;
	readonly tone: "added" | "changed" | "neutral" | "removed";
}

export function DiffView({ after, before }: DiffViewProps) {
	const diff = React.useMemo(() => diffIR(before, after), [after, before]);
	const summary = React.useMemo(() => summarizeDiff(diff), [diff]);
	const columns = React.useMemo(() => buildColumns(diff), [diff]);

	return (
		<div className="flex flex-col gap-4">
			<div className="space-y-1">
				<h3 className="text-base font-medium">Diff</h3>
				<p className="text-sm text-muted-foreground">{summary.description}</p>
			</div>
			<div className="grid gap-4 lg:grid-cols-2">
				<DiffColumn entries={columns.before} title="Before" />
				<DiffColumn entries={columns.after} title="After" />
			</div>
		</div>
	);
}

interface DiffColumnProps {
	readonly entries: readonly DiffEntry[];
	readonly title: string;
}

function DiffColumn({ entries, title }: DiffColumnProps) {
	return (
		<section aria-label={title}>
			<Card className="h-full border border-border/70">
				<CardHeader className="border-b border-border/70">
					<CardTitle>{title}</CardTitle>
					<CardDescription>{entries.length} item(s)</CardDescription>
				</CardHeader>
				<CardContent className="pt-4">
					<ul className="flex flex-col gap-3">
						{entries.map((entry) => (
							<li
								className={cn(
									"rounded-xl border px-3 py-3",
									entry.tone === "added" &&
										"border-emerald-200 bg-emerald-50 text-emerald-950",
									entry.tone === "removed" &&
										"border-rose-200 bg-rose-50 text-rose-950",
									entry.tone === "changed" &&
										"border-amber-200 bg-amber-50 text-amber-950",
									entry.tone === "neutral" &&
										"border-border bg-muted/40 text-foreground",
								)}
								key={`${title}-${entry.label}-${entry.title}-${entry.detail}`}
							>
								<div className="text-sm font-semibold">{entry.label}</div>
								<div className="mt-1 font-medium">{entry.title}</div>
								<div className="mt-1 text-sm opacity-90">{entry.detail}</div>
							</li>
						))}
					</ul>
				</CardContent>
			</Card>
		</section>
	);
}

function buildColumns(diff: IRDiff): {
	readonly after: readonly DiffEntry[];
	readonly before: readonly DiffEntry[];
} {
	if (diff.length === 0) {
		const entry = {
			detail: "Before and after match.",
			label: "No differences",
			title: "No differences",
			tone: "neutral",
		} satisfies DiffEntry;

		return {
			after: [entry],
			before: [entry],
		};
	}

	const beforeEntries: DiffEntry[] = [];
	const afterEntries: DiffEntry[] = [];

	for (const op of diff) {
		appendEntries(op, beforeEntries, afterEntries);
	}

	return {
		after: afterEntries,
		before: beforeEntries,
	};
}

function appendEntries(
	op: IRDiffOp,
	beforeEntries: DiffEntry[],
	afterEntries: DiffEntry[],
) {
	switch (op.kind) {
		case "add-node": {
			afterEntries.push({
				detail: `Added ${formatNode(op.node)} at ${op.path}.`,
				label: "+ Added",
				title: op.path,
				tone: "added",
			});
			return;
		}
		case "remove-node": {
			beforeEntries.push({
				detail: `Removed node ${op.nodeId} from ${op.path}.`,
				label: "− Removed",
				title: op.path,
				tone: "removed",
			});
			return;
		}
		case "move-node": {
			beforeEntries.push({
				detail: `Node ${op.nodeId} moved from ${op.from}.`,
				label: "~ Changed",
				title: op.nodeId,
				tone: "changed",
			});
			afterEntries.push({
				detail: `Node ${op.nodeId} moved to ${op.to}.`,
				label: "~ Changed",
				title: op.nodeId,
				tone: "changed",
			});
			return;
		}
		case "change-prop": {
			beforeEntries.push({
				detail: formatValue(op.before),
				label: "~ Changed",
				title: `${op.path}/${op.key}`,
				tone: "changed",
			});
			afterEntries.push({
				detail: formatValue(op.after),
				label: "~ Changed",
				title: `${op.path}/${op.key}`,
				tone: "changed",
			});
			return;
		}
		case "change-children": {
			beforeEntries.push({
				detail: formatValue(op.before),
				label: "~ Changed",
				title: op.path,
				tone: "changed",
			});
			afterEntries.push({
				detail: formatValue(op.after),
				label: "~ Changed",
				title: op.path,
				tone: "changed",
			});
			return;
		}
	}
}

function formatNode(node: Extract<IRDiffOp, { kind: "add-node" }>["node"]): string {
	return `${node.type} (${node.id})`;
}

function formatValue(value: unknown): string {
	if (Array.isArray(value)) {
		return value.join(", ");
	}

	if (value === undefined) {
		return "undefined";
	}

	if (typeof value === "string") {
		return value;
	}

	return JSON.stringify(value);
}
