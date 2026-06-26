import { createFakePageIR } from "@anvilkit/core/testing";
import { describe, expect, it } from "vitest";

import { VersionHistoryError } from "../utils/errors.js";
import { hashPageIR } from "../utils/hash.js";
import { checkRestoreConflict, prepareRestore } from "../utils/restore.js";

function makeIR(headline: string) {
	return createFakePageIR({
		children: [{ id: "hero-1", type: "Hero", props: { headline } }],
	});
}

describe("checkRestoreConflict", () => {
	it("reports no conflict when expectedBaseHash matches the live IR", () => {
		const currentIR = makeIR("Live");
		const result = checkRestoreConflict({
			currentIR,
			expectedBaseHash: hashPageIR(currentIR),
		});

		expect(result.hasConflict).toBe(false);
		expect(result.currentHash).toBe(hashPageIR(currentIR));
		expect(result.expectedBaseHash).toBe(hashPageIR(currentIR));
	});

	it("reports a conflict when the live IR drifted from expectedBaseHash", () => {
		const currentIR = makeIR("Edited underneath");
		const result = checkRestoreConflict({
			currentIR,
			expectedBaseHash: "stale-base-hash",
		});

		expect(result.hasConflict).toBe(true);
		expect(result.expectedBaseHash).toBe("stale-base-hash");
		expect(result.currentHash).toBe(hashPageIR(currentIR));
	});

	it("never conflicts when no expectedBaseHash is supplied (backward compatible)", () => {
		const currentIR = makeIR("Whatever");
		const result = checkRestoreConflict({ currentIR });

		expect(result.hasConflict).toBe(false);
		expect(result.expectedBaseHash).toBeUndefined();
	});
});

describe("prepareRestore", () => {
	it("returns the snapshot IR when the base hash still matches", () => {
		const currentIR = makeIR("Live");
		const snapshotIR = makeIR("Snapshot");

		const restored = prepareRestore({
			snapshotIR,
			currentIR,
			expectedBaseHash: hashPageIR(currentIR),
		});

		expect(restored).toBe(snapshotIR);
	});

	it("returns the snapshot IR when no expectedBaseHash is supplied (backward compatible)", () => {
		const currentIR = makeIR("Live");
		const snapshotIR = makeIR("Snapshot");

		expect(prepareRestore({ snapshotIR, currentIR })).toBe(snapshotIR);
	});

	it("throws a typed CONFLICT error when the document drifted under the restore", () => {
		const currentIR = makeIR("Edited underneath");
		const snapshotIR = makeIR("Snapshot");

		let thrown: unknown;
		try {
			prepareRestore({
				snapshotIR,
				currentIR,
				expectedBaseHash: "stale-base-hash",
			});
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(VersionHistoryError);
		expect((thrown as VersionHistoryError).code).toBe("CONFLICT");
	});

	it("restores anyway when force overrides a detected conflict", () => {
		const currentIR = makeIR("Edited underneath");
		const snapshotIR = makeIR("Snapshot");

		const restored = prepareRestore({
			snapshotIR,
			currentIR,
			expectedBaseHash: "stale-base-hash",
			force: true,
		});

		expect(restored).toBe(snapshotIR);
	});
});
