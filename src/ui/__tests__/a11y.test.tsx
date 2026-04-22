/** @vitest-environment jsdom */

import { createFakePageIR } from "@anvilkit/core/testing";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, expect, it, vi } from "vitest";

import { inMemoryAdapter } from "../../adapters/in-memory.js";
import { VersionHistoryUI } from "../VersionHistoryUI.js";

describe("VersionHistoryUI accessibility", () => {
	it("has no axe violations", async () => {
		const adapter = inMemoryAdapter();
		const snapshotIR = createFakePageIR({
			children: [
				{
					id: "hero-1",
					type: "Hero",
					props: { headline: "Snapshot" },
				},
			],
		});
		const currentIR = createFakePageIR({
			children: [
				{
					id: "hero-1",
					type: "Hero",
					props: { headline: "Current" },
				},
			],
		});

		await Promise.resolve(
			adapter.save(snapshotIR, {
				label: "Accessible snapshot",
			}),
		);

		const { container } = render(
			<VersionHistoryUI
				adapter={adapter}
				currentIR={currentIR}
				onRestore={vi.fn()}
			/>,
		);

		fireEvent.click(
			await screen.findByRole("listitem", { name: /Accessible snapshot/i }),
		);
		await screen.findByRole("dialog");

		const results = await axe(container);
		expect(results.violations).toHaveLength(0);
	});
});
