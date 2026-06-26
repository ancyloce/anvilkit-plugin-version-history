import { describe, expect, it } from "vitest";

import { isIRDiff } from "../utils/diff.js";

describe("isIRDiff", () => {
	it("accepts an empty array (no changes)", () => {
		expect(isIRDiff([])).toBe(true);
	});

	it("accepts a well-formed op of every kind", () => {
		expect(
			isIRDiff([
				{ kind: "remove-node", path: "/root/children/0", nodeId: "n" },
				{
					kind: "add-node",
					path: "/root/children/0",
					node: { id: "n", type: "Hero", props: {} },
				},
				{
					kind: "move-node",
					from: "/root/children/0",
					to: "/root/children/1",
					nodeId: "n",
				},
				{
					kind: "change-prop",
					path: "/root/props",
					key: "title",
					before: 1,
					after: 2,
				},
				{
					kind: "change-children",
					path: "/root/children",
					before: ["a"],
					after: ["a", "b"],
				},
				{
					kind: "meta-changed",
					path: "/root/meta",
					key: "locked",
					before: false,
					after: true,
				},
			]),
		).toBe(true);
	});

	it("accepts change-prop / meta-changed with JSON-dropped undefined before/after", () => {
		expect(
			isIRDiff([{ kind: "change-prop", path: "/root/props", key: "x" }]),
		).toBe(true);
		expect(
			isIRDiff([{ kind: "meta-changed", path: "/root/meta", key: "notes" }]),
		).toBe(true);
	});

	it("accepts an empty change-children array", () => {
		expect(
			isIRDiff([
				{
					kind: "change-children",
					path: "/root/children",
					before: [],
					after: [],
				},
			]),
		).toBe(true);
	});

	it("rejects a non-array", () => {
		expect(isIRDiff("nope")).toBe(false);
		expect(isIRDiff({})).toBe(false);
		expect(isIRDiff(null)).toBe(false);
		expect(isIRDiff(undefined)).toBe(false);
	});

	it("rejects an op that is not an object", () => {
		expect(isIRDiff(["string"])).toBe(false);
		expect(isIRDiff([null])).toBe(false);
		expect(isIRDiff([42])).toBe(false);
		expect(isIRDiff([["nested"]])).toBe(false);
	});

	it("rejects an op whose `kind` is missing or not a string", () => {
		expect(isIRDiff([{ path: "/root" }])).toBe(false);
		expect(isIRDiff([{ kind: 7, path: "/root" }])).toBe(false);
	});

	it("rejects an op with an unknown `kind` discriminant", () => {
		expect(isIRDiff([{ kind: "frobnicate", path: "/root" }])).toBe(false);
	});

	it("rejects ops missing a required field for their kind", () => {
		// remove-node without nodeId
		expect(isIRDiff([{ kind: "remove-node", path: "/root/children/0" }])).toBe(
			false,
		);
		// add-node without a node object
		expect(isIRDiff([{ kind: "add-node", path: "/root/children/0" }])).toBe(
			false,
		);
		// add-node whose node lacks string id/type
		expect(
			isIRDiff([
				{ kind: "add-node", path: "/root/children/0", node: { type: "X" } },
			]),
		).toBe(false);
		// move-node missing `to`
		expect(
			isIRDiff([{ kind: "move-node", from: "/root/children/0", nodeId: "n" }]),
		).toBe(false);
		// change-prop without a string key
		expect(isIRDiff([{ kind: "change-prop", path: "/root/props" }])).toBe(
			false,
		);
		// change-children whose `after` is not a string array
		expect(
			isIRDiff([
				{
					kind: "change-children",
					path: "/root/children",
					before: [],
					after: [1],
				},
			]),
		).toBe(false);
		// meta-changed with a key outside the allowed set
		expect(
			isIRDiff([{ kind: "meta-changed", path: "/root/meta", key: "bogus" }]),
		).toBe(false);
	});

	it("rejects when any single op in an otherwise-valid array is malformed", () => {
		expect(
			isIRDiff([
				{ kind: "remove-node", path: "/root/children/0", nodeId: "n" },
				{ kind: "remove-node", path: "/root/children/1" /* no nodeId */ },
			]),
		).toBe(false);
	});
});
