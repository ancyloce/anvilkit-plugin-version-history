import { defineStudioPlugin } from "@anvilkit/core/types";
import type {
	StudioPluginContributing,
	StudioPluginRegistration,
} from "@anvilkit/core/types";

import config from "../meta/config.json";
import packageJson from "../package.json";
import { openHistoryAction, saveSnapshotAction } from "./actions/header-actions";
import {
	bindVersionHistoryState,
	setVersionHistorySnapshots,
	unbindVersionHistoryState,
} from "./utils/state.js";
import type {
	SnapshotAdapter,
	VersionHistoryContribution,
} from "./types/types.js";

// `version` is derived from package.json so a Changesets bump can never drift
// the runtime metadata; `plugin.metadata-drift.test.ts` guards regressions.
const META = {
	...config,
	version: packageJson.version,
} as const;

export interface CreateVersionHistoryPluginOptions {
	readonly adapter: SnapshotAdapter;
	readonly maxSnapshots?: number;
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
		register(_ctx) {
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

			// TODO(phase5-013): contribute the sidebar-panel slot here once
			// StudioPluginContext exposes the sidebar registration API.
			return registration;
		},
	});
}
