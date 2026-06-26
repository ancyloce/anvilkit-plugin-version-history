import { describe, expect, it } from "vitest";

import {
	createPermissionDeniedError,
	VersionHistoryError,
	type VersionHistoryErrorCode,
} from "../utils/errors.js";

/**
 * Exhaustive routing table over the *whole* discriminated error contract,
 * including the authorization code `PERMISSION_DENIED`. The `satisfies`
 * constraint makes this a type-level exhaustiveness check: adding a code to
 * `VersionHistoryErrorCode` without a row here stops the object from
 * satisfying `Record<VersionHistoryErrorCode, …>`.
 */
const CODE_CATEGORY = {
	CONFLICT: "concurrency",
	PERMISSION_DENIED: "authorization",
	SNAPSHOT_NOT_FOUND: "lookup",
	STORAGE_CORRUPT: "storage",
	STORAGE_QUOTA_EXCEEDED: "storage",
	STORAGE_UNAVAILABLE: "storage",
} satisfies Record<VersionHistoryErrorCode, string>;

function categorize(error: VersionHistoryError): string {
	return CODE_CATEGORY[error.code];
}

describe("VersionHistoryError PERMISSION_DENIED", () => {
	it("carries a discriminable PERMISSION_DENIED code when constructed directly", () => {
		const error = new VersionHistoryError(
			"PERMISSION_DENIED",
			"actor is not authorized",
		);

		expect(error).toBeInstanceOf(VersionHistoryError);
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe("VersionHistoryError");
		expect(error.code).toBe("PERMISSION_DENIED");
		// Discriminates as an authorization failure — distinct from storage,
		// lookup, and concurrency categories.
		expect(categorize(error)).toBe("authorization");
	});

	it("createPermissionDeniedError builds a PERMISSION_DENIED error for an operation", () => {
		const error = createPermissionDeniedError("restore");

		expect(error).toBeInstanceOf(VersionHistoryError);
		expect(error.code).toBe("PERMISSION_DENIED");
		expect(error.message).toContain("restore");
		expect(categorize(error)).toBe("authorization");
	});

	it("appends optional detail to the message", () => {
		const error = createPermissionDeniedError(
			"save",
			"actor lacks the editor role",
		);

		expect(error.code).toBe("PERMISSION_DENIED");
		expect(error.message).toContain("actor lacks the editor role");
	});
});
