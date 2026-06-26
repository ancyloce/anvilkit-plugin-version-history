import type {
	StudioHistoryPanel,
	StudioPluginContributing,
	StudioPluginRegistration,
} from "@anvilkit/core/types";
import { defineStudioPlugin } from "@anvilkit/core/types";
import { History } from "lucide-react";
import type { ReactNode } from "react";
import { createElement } from "react";

import config from "../meta/config.json";
import packageJson from "../package.json";
import {
	openHistoryAction,
	saveSnapshotAction,
} from "./actions/header-actions";
import { VERSION_HISTORY_ENTRY } from "./i18n/entry.js";
import type {
	BuildPageIR,
	SnapshotAdapter,
	VersionHistoryContribution,
} from "./types/types.js";
import {
	bindVersionHistoryState,
	setVersionHistorySnapshots,
	unbindVersionHistoryState,
} from "./utils/state.js";

// `version` is derived from package.json so a Changesets bump can never drift
// the runtime metadata; `plugin.metadata-drift.test.ts` guards regressions.
const META = {
	...config,
	version: packageJson.version,
	icon: createElement(History),
} as const;

/** Options for {@link createVersionHistoryPlugin}. */
export interface CreateVersionHistoryPluginOptions {
	/**
	 * Storage backend the plugin persists snapshots to and pre-loads the
	 * history from (via `adapter.list()` during `onInit`). Required.
	 */
	readonly adapter: SnapshotAdapter;
	/**
	 * Soft cap on retained snapshots, threaded into the bound plugin state for
	 * the host's eviction logic. A non-finite or non-positive value (and
	 * omission) means "unbounded"; otherwise it is truncated to an integer.
	 */
	readonly maxSnapshots?: number;
	/**
	 * Convert the live editor document (`ctx.getData()`) into the `PageIR`
	 * the adapter persists. In a real `<Studio>` session `ctx.getData()`
	 * returns Puck `Data`, which the header save action cannot persist on
	 * its own — supply this bridge so "Save snapshot" works in production.
	 *
	 * The save action keeps a fast-path for data that is already a `PageIR`
	 * (e.g. headless hosts) and only calls `buildIR` when that fast-path
	 * rejects the data. Omitting it preserves the prior behavior: saves of
	 * non-`PageIR` data are skipped. See {@link BuildPageIR}.
	 */
	readonly buildIR?: BuildPageIR;
	/**
	 * Render the body of the StudioSidebar `history` module. When supplied,
	 * the plugin registers a `StudioHistoryPanel` through the supported,
	 * rendered `ctx.registerHistoryPanel` core slot during `register()` —
	 * which makes the `history` rail tab appear (`SidebarRail` gates it on
	 * `historyPanel !== null`) and renders this thunk inside the panel body
	 * via core's `HistoryModule`. The runtime auto-tears-down the
	 * registration on `<Studio>` unmount, so no manual cleanup is needed.
	 *
	 * Typically returns `<VersionHistoryUI adapter currentIR onRestore />`
	 * (importable from `@anvilkit/plugin-version-history/ui`). The host owns
	 * the reactive Puck-data read (→ `currentIR`) and the restore dispatch
	 * (`onRestore`) because a plugin submodule may resolve its own
	 * `@puckeditor/core` copy at runtime (the dual-puck hazard); reading
	 * Puck state must therefore happen in the host's React/Puck context.
	 *
	 * Omitting it preserves the prior header-actions-only behavior — the
	 * plugin contributes no sidebar panel and the `history` rail tab stays
	 * hidden.
	 */
	readonly renderPanel?: () => ReactNode;
}

export function createVersionHistoryPlugin(
	options: CreateVersionHistoryPluginOptions,
): StudioPluginContributing<VersionHistoryContribution> {
	const maxSnapshots =
		options.maxSnapshots !== undefined &&
		Number.isFinite(options.maxSnapshots) &&
		options.maxSnapshots > 0
			? Math.trunc(options.maxSnapshots)
			: undefined;

	return defineStudioPlugin<VersionHistoryContribution>({
		meta: META,
		register(ctx) {
			ctx.registerMessages(VERSION_HISTORY_ENTRY);
			const token = {};
			const headerActions: StudioPluginRegistration["headerActions"] = [
				{
					...saveSnapshotAction,
					async onClick(ctx) {
						ctx.emit("version-history:save-requested");
						await saveSnapshotAction.onClick(ctx);
					},
				},
				{
					...openHistoryAction,
					onClick(ctx) {
						ctx.emit("version-history:open-requested");
						return openHistoryAction.onClick(ctx);
					},
				},
			];

			const registration: StudioPluginRegistration = {
				meta: META,
				headerActions,
				hooks: {
					async onInit(initCtx) {
						bindVersionHistoryState(token, initCtx, {
							adapter: options.adapter,
							buildIR: options.buildIR,
							maxSnapshots,
							saveInFlight: false,
							snapshots: [],
						});

						try {
							const snapshots = await Promise.resolve(options.adapter.list());
							setVersionHistorySnapshots(initCtx, snapshots);
						} catch (error) {
							initCtx.log(
								"warn",
								"Version history could not pre-load snapshots during onInit.",
								{
									error: error instanceof Error ? error.message : String(error),
								},
							);
						}
					},
					onDestroy(destroyCtx) {
						unbindVersionHistoryState(token, destroyCtx);
					},
				},
			};

			// Contribute the StudioSidebar `history` panel through the
			// supported, rendered `registerHistoryPanel` slot. Registered on
			// the `register()` ctx so the runtime collects the unregister
			// handle for auto-teardown (no manual cleanup needed); guarded
			// with `?.` because a hand-written test ctx may omit the optional
			// register method.
			if (options.renderPanel !== undefined) {
				const renderPanel = options.renderPanel;
				const panel: StudioHistoryPanel = {
					render: () => renderPanel(),
				};
				ctx.registerHistoryPanel?.(panel);
			}

			return registration;
		},
	});
}
