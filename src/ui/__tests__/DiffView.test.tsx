/** @vitest-environment jsdom */

import { createFakePageIR } from "@anvilkit/core/testing";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DiffView } from "../DiffView.js";

describe("DiffView", () => {
	it("renders side-by-side columns with visible diff labels", () => {
		const before = createFakePageIR({
			children: [
				{
					id: "hero-1",
					type: "Hero",
					props: { headline: "Hello" },
				},
				{
					id: "cta-1",
					type: "Button",
					props: { label: "Start" },
				},
			],
		});
		const after = createFakePageIR({
			children: [
				{
					id: "hero-1",
					type: "Hero",
					props: { headline: "Hello again" },
				},
				{
					id: "gallery-1",
					type: "Gallery",
					props: { title: "New section" },
				},
			],
		});

		render(<DiffView after={after} before={before} />);

		expect(screen.getByRole("region", { name: "Before" })).toBeTruthy();
		expect(screen.getByRole("region", { name: "After" })).toBeTruthy();
		expect(screen.getByText("+ Added")).toBeTruthy();
		expect(screen.getByText("− Removed")).toBeTruthy();
		expect(screen.getAllByText("~ Changed").length).toBeGreaterThan(0);
	});
});
