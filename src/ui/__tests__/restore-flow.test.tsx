/** @vitest-environment jsdom */

import { createFakePageIR } from "@anvilkit/core/testing";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { inMemoryAdapter } from "../../adapters/in-memory.js";
import type { SnapshotAdapter, SnapshotMeta } from "../../types.js";
import { VersionHistoryUI } from "../VersionHistoryUI.js";

describe("VersionHistoryUI restore flow", () => {
	it("saves, lists, opens, and restores a snapshot", async () => {
		const adapter = inMemoryAdapter();
		const savedIR = createFakePageIR({
			children: [
				{
					id: "hero-1",
					type: "Hero",
					props: { headline: "Baseline" },
				},
			],
		});
		const currentIR = createFakePageIR({
			children: [
				{
					id: "hero-1",
					type: "Hero",
					props: { headline: "Updated" },
				},
			],
		});
		const onRestore = vi.fn();
		const { rerender } = render(
			<VersionHistoryUI
				adapter={adapter}
				currentIR={savedIR}
				onRestore={onRestore}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Save snapshot" }));
		fireEvent.change(screen.getByLabelText("Label"), {
			target: { value: "Initial" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		const row = await screen.findByRole("listitem", { name: /Initial/i });
		expect(row).toBeTruthy();

		rerender(
			<VersionHistoryUI
				adapter={adapter}
				currentIR={currentIR}
				onRestore={onRestore}
			/>,
		);

		fireEvent.click(await screen.findByRole("listitem", { name: /Initial/i }));
		await screen.findByRole("dialog");

		await waitFor(() => {
			expect(
				(
					screen.getByRole("button", { name: "Restore" }) as HTMLButtonElement
				).disabled,
			).toBe(false);
		});

		fireEvent.click(screen.getByRole("button", { name: "Restore" }));

		await waitFor(() => {
			expect(onRestore).toHaveBeenCalledTimes(1);
		});
		expect(onRestore.mock.calls[0]?.[0]).toEqual(savedIR);
	});

	it("surfaces an error in the modal when adapter.load rejects", async () => {
		const currentIR = createFakePageIR({
			children: [
				{
					id: "hero-1",
					type: "Hero",
					props: { headline: "Current" },
				},
			],
		});
		const meta: SnapshotMeta = {
			id: "broken-snapshot",
			label: "Broken",
			savedAt: new Date(0).toISOString(),
			pageIRHash: "deadbeef",
		};
		const adapter: SnapshotAdapter = {
			save: vi.fn(() => meta.id),
			list: vi.fn(() => [meta]),
			load: vi.fn(() => {
				throw new Error("boom: payload corrupted");
			}),
			delete: vi.fn(),
		};

		render(
			<VersionHistoryUI
				adapter={adapter}
				currentIR={currentIR}
				onRestore={vi.fn()}
			/>,
		);

		fireEvent.click(await screen.findByRole("listitem", { name: /Broken/i }));
		await screen.findByRole("dialog");

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("boom: payload corrupted");

		expect(
			(screen.getByRole("button", { name: "Restore" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});
});
