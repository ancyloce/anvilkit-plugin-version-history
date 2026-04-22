/** @vitest-environment jsdom */

import {
	createFakePageIR,
	createFakeStudioContext,
	registerPlugin,
} from "@anvilkit/core/testing";
import type { StudioHeaderAction, StudioPluginContext } from "@anvilkit/core/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

import { inMemoryAdapter } from "../adapters/in-memory.js";
import { createVersionHistoryPlugin } from "../plugin.js";

describe("createVersionHistoryPlugin RTL", () => {
	it("round-trips save, list, and load from a rendered header action", async () => {
		const adapter = inMemoryAdapter();
		const ir = createFakePageIR({
			rootId: "rtl-root",
			metadata: { createdAt: new Date(0).toISOString() },
		});
		const ctx = createFakeStudioContext({
			getData: () => asPuckData(ir),
		});
		const harness = await registerPlugin(
			createVersionHistoryPlugin({ adapter }),
			{ ctx },
		);

		await harness.runInit();

		render(
			React.createElement(ActionHarness, {
				actions: harness.registration.headerActions ?? [],
				ctx,
			}),
		);

		fireEvent.click(screen.getByRole("button", { name: "Save snapshot" }));

		await waitFor(async () => {
			expect(await Promise.resolve(adapter.list())).toHaveLength(1);
		});

		const snapshots = await Promise.resolve(adapter.list());
		const loaded = await Promise.resolve(adapter.load(snapshots[0]!.id));
		expect(loaded).toEqual(ir);
	});
});

interface ActionHarnessProps {
	readonly actions: readonly StudioHeaderAction[];
	readonly ctx: StudioPluginContext;
}

function ActionHarness({ actions, ctx }: ActionHarnessProps) {
	return React.createElement(
		"div",
		undefined,
		...actions.map((action) =>
			React.createElement(
				"button",
				{
					key: action.id,
					onClick: () => {
						void action.onClick(ctx);
					},
					type: "button",
				},
				action.label,
			),
		),
	);
}

function asPuckData(
	ir: ReturnType<typeof createFakePageIR>,
): ReturnType<StudioPluginContext["getData"]> {
	return ir as unknown as ReturnType<StudioPluginContext["getData"]>;
}
