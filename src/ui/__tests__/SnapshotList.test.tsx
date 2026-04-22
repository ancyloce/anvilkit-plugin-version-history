/** @vitest-environment jsdom */

import { createFakePageIR } from "@anvilkit/core/testing";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SnapshotMeta } from "../../types.js";
import { SnapshotList } from "../SnapshotList.js";

describe("SnapshotList", () => {
	it("renders snapshots with ARIA roles and keyboard navigation", async () => {
		const currentIR = createFakePageIR();
		const snapshots: readonly SnapshotMeta[] = [
			{
				id: "snapshot-1",
				label: "First snapshot",
				pageIRHash: "hash-1",
				savedAt: new Date(0).toISOString(),
			},
			{
				id: "snapshot-2",
				label: "Second snapshot",
				pageIRHash: "hash-2",
				savedAt: new Date(1_000).toISOString(),
			},
		];
		const loadSnapshot = vi.fn(async () => currentIR);
		const onOpen = vi.fn();

		render(
			<SnapshotList
				currentIR={currentIR}
				loadSnapshot={loadSnapshot}
				onOpen={onOpen}
				snapshots={snapshots}
			/>,
		);

		expect(screen.getByRole("list", { name: "Snapshots" })).toBeTruthy();
		const rows = screen.getAllByRole("listitem");
		expect(rows).toHaveLength(2);

		await waitFor(() => {
			expect(loadSnapshot).toHaveBeenCalledTimes(2);
		});

		rows[0]?.focus();
		fireEvent.keyDown(rows[0]!, { key: "ArrowDown" });
		expect(document.activeElement).toBe(rows[1]);

		fireEvent.keyDown(rows[1]!, { key: "ArrowUp" });
		expect(document.activeElement).toBe(rows[0]);

		fireEvent.keyDown(rows[1]!, { key: "Enter" });
		expect(onOpen).toHaveBeenCalledWith("snapshot-2");
	});
});
