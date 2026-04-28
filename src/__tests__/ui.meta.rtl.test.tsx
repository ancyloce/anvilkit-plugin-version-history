/** @vitest-environment jsdom */

/**
 * @file UI tests for the M10-T3 surfaces in `@anvilkit/plugin-version-history`:
 *
 * - `DiffView` renders `meta-changed` ops with a "~ Meta {key}" label
 *   and a 🔒 glyph for the `locked` key.
 * - `SnapshotList` renders a 🔒 lock badge on rows whose latest IR
 *   contains any node with `meta.locked === true`.
 */

import type { PageIR } from "@anvilkit/core/types";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => {
	cleanup();
});

import type { SnapshotMeta } from "../types.js";
import { DiffView } from "../ui/DiffView.js";
import { SnapshotList } from "../ui/SnapshotList.js";

function pageWithLeaf(meta?: PageIR["root"]["meta"]): PageIR {
	return {
		version: "1",
		root: {
			id: "root",
			type: "Root",
			props: {},
			children: [
				meta === undefined
					? { id: "hero", type: "Hero", props: {} }
					: { id: "hero", type: "Hero", props: {}, meta },
			],
		},
		assets: [],
		metadata: {},
	};
}

describe("DiffView — meta-changed surface", () => {
	it("renders a row labeled with the changed meta key", () => {
		const before = pageWithLeaf();
		const after = pageWithLeaf({ owner: "team-a" });
		render(<DiffView before={before} after={after} />);
		expect(screen.getAllByText(/Meta owner/).length).toBeGreaterThanOrEqual(1);
	});

	it("renders the 🔒 glyph for the `locked` meta key", () => {
		const before = pageWithLeaf();
		const after = pageWithLeaf({ locked: true });
		render(<DiffView before={before} after={after} />);
		expect(screen.getAllByText(/🔒 locked/).length).toBeGreaterThanOrEqual(1);
	});
});

describe("SnapshotList — lock badge", () => {
	const baseSnapshot: SnapshotMeta = {
		id: "snap-1",
		label: "First save",
		savedAt: new Date("2027-05-01T00:00:00Z").toISOString(),
	};

	it("shows the 🔒 badge when the snapshot contains a locked node", async () => {
		const lockedIR = pageWithLeaf({ locked: true });
		render(
			<SnapshotList
				currentIR={lockedIR}
				loadSnapshot={() => Promise.resolve(lockedIR)}
				onOpen={() => {}}
				snapshots={[baseSnapshot]}
			/>,
		);
		await waitFor(() => {
			expect(screen.getByLabelText("Snapshot contains locked nodes")).toBeTruthy();
		});
	});

	it("hides the 🔒 badge for snapshots without locked nodes", async () => {
		const ir = pageWithLeaf();
		render(
			<SnapshotList
				currentIR={ir}
				loadSnapshot={() => Promise.resolve(ir)}
				onOpen={() => {}}
				snapshots={[baseSnapshot]}
			/>,
		);
		// The snapshot summary updates async; once it's not "Loading...",
		// the lock-badge state is finalized too.
		await waitFor(() => {
			expect(screen.queryByText(/Loading/)).toBeNull();
		});
		expect(screen.queryByLabelText("Snapshot contains locked nodes")).toBeNull();
	});
});
