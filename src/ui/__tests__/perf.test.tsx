/** @vitest-environment jsdom */

import { createFakePageIR } from "@anvilkit/core/testing";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SnapshotMeta } from "../../types.js";
import { SnapshotList } from "../SnapshotList.js";

describe("SnapshotList performance", () => {
	it("renders one hundred snapshots under the jsdom budget", () => {
		const currentIR = createFakePageIR();
		const snapshots: readonly SnapshotMeta[] = Array.from(
			{ length: 100 },
			(_, index) => ({
				id: `snapshot-${index}`,
				label: `Snapshot ${index}`,
				pageIRHash: `hash-${index}`,
				savedAt: new Date(index * 1_000).toISOString(),
			}),
		);
		const pendingLoad = new Promise<ReturnType<typeof createFakePageIR>>(() => {});
		const start = performance.now();

		render(
			<SnapshotList
				currentIR={currentIR}
				loadSnapshot={() => pendingLoad}
				onOpen={() => {}}
				snapshots={snapshots}
			/>,
		);

		const end = performance.now();
		expect(end - start).toBeLessThan(1500);
	});
});
