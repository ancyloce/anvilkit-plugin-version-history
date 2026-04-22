import type { StudioPlugin, StudioPluginRegistration } from "@anvilkit/core/types";

import { openHistoryAction, saveSnapshotAction } from "./header-actions.js";
import { bindVersionHistoryState, setVersionHistorySnapshots, unbindVersionHistoryState } from "./state.js";
import type { SnapshotAdapter } from "./types.js";

const META = {
	id: "anvilkit-plugin-version-history",
	name: "Version History",
	version: "0.1.0-alpha.0",
	coreVersion: "^0.1.0-alpha",
	description:
		"Headless version history plugin with host-provided snapshot persistence.",
} as const;

export interface CreateVersionHistoryPluginOptions {
	readonly adapter: SnapshotAdapter;
	readonly maxSnapshots?: number;
}

export function createVersionHistoryPlugin(
	options: CreateVersionHistoryPluginOptions,
): StudioPlugin {
	const token = {};
	const maxSnapshots =
		options.maxSnapshots !== undefined &&
		Number.isFinite(options.maxSnapshots) &&
		options.maxSnapshots > 0
			? Math.trunc(options.maxSnapshots)
			: undefined;

	return {
		meta: META,
		register(_ctx) {
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
									error:
										error instanceof Error ? error.message : String(error),
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
	};
}
