/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SaveSnapshotButton } from "../SaveSnapshotButton.js";

describe("SaveSnapshotButton", () => {
	it("collects an optional label with an inline form", async () => {
		const onSave = vi.fn().mockResolvedValue(undefined);

		render(<SaveSnapshotButton onSave={onSave} />);

		fireEvent.click(screen.getByRole("button", { name: "Save snapshot" }));
		fireEvent.change(screen.getByLabelText("Label"), {
			target: { value: "Release candidate" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => {
			expect(onSave).toHaveBeenCalledWith("Release candidate");
		});
	});
});
