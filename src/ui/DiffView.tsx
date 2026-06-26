import * as React from "react";

import { useMsg } from "@anvilkit/core/i18n";
import type { PageIR } from "@anvilkit/core/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
} from "@anvilkit/ui";

import type { IRDiff, IRDiffOp } from "../utils/diff.js";
import { diffIR, summarizeDiff } from "../utils/diff.js";
import { formatSummaryDescription } from "./format-summary.js";

/** The `useMsg()` resolver shape, threaded into the pure column builders. */
type Msg = (key: string, fallback?: string) => string;

/** Props for {@link DiffView}. */
export interface DiffViewProps {
  /** The newer document — the live editor IR (right / "after" column). */
  readonly after: PageIR;
  /** The older document — the opened snapshot's IR (left / "before" column). */
  readonly before: PageIR;
}

interface DiffEntry {
  readonly detail: string;
  readonly label: string;
  readonly title: string;
  readonly tone: "added" | "changed" | "neutral" | "removed";
}

export function DiffView({ after, before }: DiffViewProps) {
  const msg = useMsg();
  const diff = React.useMemo(() => diffIR(before, after), [after, before]);
  const summary = React.useMemo(() => summarizeDiff(diff), [diff]);
  const columns = React.useMemo(() => buildColumns(diff, msg), [diff, msg]);

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1">
        <h3 className="text-base font-medium">
          {msg("versionHistory.diff.title")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {formatSummaryDescription(summary, msg)}
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <DiffColumn
          entries={columns.before}
          title={msg("versionHistory.diff.before")}
        />
        <DiffColumn
          entries={columns.after}
          title={msg("versionHistory.diff.after")}
        />
      </div>
    </div>
  );
}

interface DiffColumnProps {
  readonly entries: readonly DiffEntry[];
  readonly title: string;
}

function DiffColumn({ entries, title }: DiffColumnProps) {
  const msg = useMsg();
  return (
    <section aria-label={title}>
      <Card className="h-full border border-border/70">
        <CardHeader className="border-b border-border/70">
          <CardTitle>{title}</CardTitle>
          <CardDescription>
            {msg("versionHistory.diff.items").replace(
              "{count}",
              String(entries.length),
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <ul className="flex flex-col gap-3">
            {entries.map((entry, entryIndex) => (
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
                key={`${title}-${entryIndex}-${entry.label}-${entry.title}`}
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

function buildColumns(
  diff: IRDiff,
  msg: Msg,
): {
  readonly after: readonly DiffEntry[];
  readonly before: readonly DiffEntry[];
} {
  if (diff.length === 0) {
    const noDiffLabel = msg("versionHistory.diff.noDiffLabel");
    const entry = {
      detail: msg("versionHistory.diff.noDiffDetail"),
      label: noDiffLabel,
      title: noDiffLabel,
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
    appendEntries(op, beforeEntries, afterEntries, msg);
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
  msg: Msg,
) {
  const changedLabel = msg("versionHistory.diff.changed");
  switch (op.kind) {
    case "add-node": {
      afterEntries.push({
        detail: msg("versionHistory.diff.detailAdded")
          .replace("{node}", formatNode(op.node))
          .replace("{path}", op.path),
        label: msg("versionHistory.diff.added"),
        title: op.path,
        tone: "added",
      });
      return;
    }
    case "remove-node": {
      beforeEntries.push({
        detail: msg("versionHistory.diff.detailRemoved")
          .replace("{nodeId}", op.nodeId)
          .replace("{path}", op.path),
        label: msg("versionHistory.diff.removed"),
        title: op.path,
        tone: "removed",
      });
      return;
    }
    case "move-node": {
      beforeEntries.push({
        detail: msg("versionHistory.diff.detailMovedFrom")
          .replace("{nodeId}", op.nodeId)
          .replace("{from}", op.from),
        label: changedLabel,
        title: op.nodeId,
        tone: "changed",
      });
      afterEntries.push({
        detail: msg("versionHistory.diff.detailMovedTo")
          .replace("{nodeId}", op.nodeId)
          .replace("{to}", op.to),
        label: changedLabel,
        title: op.nodeId,
        tone: "changed",
      });
      return;
    }
    case "change-prop": {
      beforeEntries.push({
        detail: formatValue(op.before),
        label: changedLabel,
        title: `${op.path}/${op.key}`,
        tone: "changed",
      });
      afterEntries.push({
        detail: formatValue(op.after),
        label: changedLabel,
        title: `${op.path}/${op.key}`,
        tone: "changed",
      });
      return;
    }
    case "change-children": {
      beforeEntries.push({
        detail: formatValue(op.before),
        label: changedLabel,
        title: op.path,
        tone: "changed",
      });
      afterEntries.push({
        detail: formatValue(op.after),
        label: changedLabel,
        title: op.path,
        tone: "changed",
      });
      return;
    }
    case "meta-changed": {
      const lockGlyph = op.key === "locked" ? "🔒 " : "";
      const label =
        `${msg("versionHistory.diff.metaPrefix")} ${lockGlyph}${op.key}`.trimEnd();
      beforeEntries.push({
        detail: formatValue(op.before),
        label,
        title: `${op.path}.${op.key}`,
        tone: "changed",
      });
      afterEntries.push({
        detail: formatValue(op.after),
        label,
        title: `${op.path}.${op.key}`,
        tone: "changed",
      });
      return;
    }
  }
}

function formatNode(
  node: Extract<IRDiffOp, { kind: "add-node" }>["node"],
): string {
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
