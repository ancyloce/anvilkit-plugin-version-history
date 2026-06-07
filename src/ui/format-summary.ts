/**
 * @file Localized rendering of an {@link IRDiffSummary}.
 *
 * `summarizeDiff` (a React-free pure function) still computes an English
 * `description`, but the UI ignores that string and rebuilds the sentence
 * from the numeric counts here so it can be localized. The output is
 * byte-identical to `summarizeDiff().description` under the English catalog.
 */

import type { IRDiffSummary } from "../utils/diff.js";

/** The `useMsg()` resolver shape (`(key, fallback?) => string`). */
type Msg = (key: string, fallback?: string) => string;

/**
 * Build the localized one-line diff summary (e.g. "3 changes: 2 added,
 * 1 removed") from a summary's counts. Mirrors `summarizeDiff`'s ordering
 * (added → removed → moved → changed → meta) and singular/plural noun.
 */
export function formatSummaryDescription(
	summary: IRDiffSummary,
	msg: Msg,
): string {
	const { added, removed, moved, changed } = summary;
	const metaChanged = summary.metaChanged ?? 0;
	const total = added + removed + moved + changed + metaChanged;

	if (total === 0) {
		return msg("versionHistory.summary.none");
	}

	const parts: string[] = [];
	if (added > 0) {
		parts.push(
			msg("versionHistory.summary.added").replace("{n}", String(added)),
		);
	}
	if (removed > 0) {
		parts.push(
			msg("versionHistory.summary.removed").replace("{n}", String(removed)),
		);
	}
	if (moved > 0) {
		parts.push(
			msg("versionHistory.summary.moved").replace("{n}", String(moved)),
		);
	}
	if (changed > 0) {
		parts.push(
			msg("versionHistory.summary.changed").replace("{n}", String(changed)),
		);
	}
	if (metaChanged > 0) {
		parts.push(
			msg("versionHistory.summary.meta").replace("{n}", String(metaChanged)),
		);
	}

	const noun =
		total === 1
			? msg("versionHistory.summary.changeOne")
			: msg("versionHistory.summary.changeMany");

	return msg("versionHistory.summary.head")
		.replace("{total}", String(total))
		.replace("{noun}", noun)
		.replace("{parts}", parts.join(msg("versionHistory.summary.sep")));
}
