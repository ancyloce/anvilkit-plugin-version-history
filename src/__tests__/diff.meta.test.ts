/**
 * @file Fixed-shape tests for the `meta-changed` diff op (M10-T3 /
 * `phase6-008`). Locks the round-trip contract on each meta-key
 * transition (`locked`, `owner`, `version`, `notes`) plus the empty-
 * meta and absent-meta boundary cases.
 */

import type { PageIR, PageIRNode, PageIRNodeMeta } from "@anvilkit/core/types";
import { describe, expect, it } from "vitest";

import { applyDiff, diffIR, summarizeDiff } from "../diff.js";

function leaf(id: string, meta?: PageIRNodeMeta): PageIRNode {
	return meta === undefined
		? { id, type: "Leaf", props: {} }
		: { id, type: "Leaf", props: {}, meta };
}

function page(child: PageIRNode): PageIR {
	return {
		version: "1",
		root: {
			id: "root",
			type: "Root",
			props: {},
			children: [child],
		},
		assets: [],
		metadata: {},
	};
}

describe("diffIR — meta-changed op", () => {
	it("emits no meta op when both sides have undefined meta", () => {
		const a = page(leaf("a"));
		const b = page(leaf("a"));
		expect(diffIR(a, b)).toEqual([]);
		expect(summarizeDiff(diffIR(a, b)).metaChanged).toBeUndefined();
	});

	it("emits one op when locked toggles undefined → true", () => {
		const a = page(leaf("a"));
		const b = page(leaf("a", { locked: true }));
		const diff = diffIR(a, b);
		expect(diff).toHaveLength(1);
		expect(diff[0]).toMatchObject({
			kind: "meta-changed",
			path: "/root/children/0/meta",
			key: "locked",
			before: undefined,
			after: true,
		});
		expect(summarizeDiff(diff).metaChanged).toBe(1);
		expect(summarizeDiff(diff).description).toContain("1 meta");
	});

	it("emits one op when notes change a → b", () => {
		const a = page(leaf("a", { notes: "first" }));
		const b = page(leaf("a", { notes: "second" }));
		const diff = diffIR(a, b);
		expect(diff).toHaveLength(1);
		expect(diff[0]).toMatchObject({
			kind: "meta-changed",
			key: "notes",
			before: "first",
			after: "second",
		});
	});

	it("emits one op per changed key when multiple meta fields differ", () => {
		const a = page(leaf("a", { locked: true, owner: "team-a" }));
		const b = page(
			leaf("a", { locked: false, owner: "team-b", version: "1.0.0" }),
		);
		const diff = diffIR(a, b);
		const metaOps = diff.filter((op) => op.kind === "meta-changed");
		expect(metaOps).toHaveLength(3);
		expect(new Set(metaOps.map((op) => (op as { key: string }).key))).toEqual(
			new Set(["locked", "owner", "version"]),
		);
	});

	it("emits no op when meta is byte-equal across both sides", () => {
		const a = page(leaf("a", { locked: true, owner: "team-a" }));
		const b = page(leaf("a", { locked: true, owner: "team-a" }));
		expect(diffIR(a, b)).toEqual([]);
	});

	it("treats meta:{} same as meta absent for diff purposes", () => {
		const a = page(leaf("a"));
		const b = page(leaf("a", {}));
		expect(diffIR(a, b)).toEqual([]);
	});

	it("round-trips applyDiff(a, diffIR(a, b)) ≡ b for locked toggle", () => {
		const a = page(leaf("a"));
		const b = page(leaf("a", { locked: true }));
		const replayed = applyDiff(a, diffIR(a, b));
		expect(replayed).toEqual(b);
	});

	it("round-trips applyDiff for owner field set→unset", () => {
		const a = page(leaf("a", { owner: "team-a" }));
		const b = page(leaf("a"));
		const replayed = applyDiff(a, diffIR(a, b));
		expect(replayed.root.children?.[0]?.meta).toBeUndefined();
	});

	it("round-trips applyDiff for owner shift on existing meta", () => {
		const a = page(leaf("a", { owner: "team-a", locked: true }));
		const b = page(leaf("a", { owner: "team-b", locked: true }));
		const replayed = applyDiff(a, diffIR(a, b));
		expect(replayed.root.children?.[0]?.meta).toEqual({
			owner: "team-b",
			locked: true,
		});
	});

	it("round-trips applyDiff for full meta:{} → meta:{}", () => {
		const a = page(leaf("a", { locked: true, owner: "team-a" }));
		const b = page(leaf("a"));
		const replayed = applyDiff(a, diffIR(a, b));
		expect(replayed.root.children?.[0]?.meta).toBeUndefined();
	});

	it("rejects an apply when current meta value diverges from `before`", () => {
		const a = page(leaf("a", { owner: "team-a" }));
		const b = page(leaf("a", { owner: "team-b" }));
		const diff = diffIR(a, b);
		const stale = page(leaf("a", { owner: "team-c" }));
		expect(() => applyDiff(stale, diff)).toThrow(/Meta mismatch/);
	});

	it("orders meta-changed ops after change-prop ops in the same node", () => {
		const a = page({ ...leaf("a"), props: { title: "Old" } });
		const b = page({
			...leaf("a", { locked: true }),
			props: { title: "New" },
		});
		const diff = diffIR(a, b);
		const kinds = diff.map((op) => op.kind);
		expect(kinds.indexOf("change-prop")).toBeLessThan(
			kinds.indexOf("meta-changed"),
		);
	});

	it("summarizeDiff includes metaChanged in its description", () => {
		const a = page(leaf("a"));
		const b = page(leaf("a", { locked: true, owner: "team-a" }));
		const summary = summarizeDiff(diffIR(a, b));
		expect(summary.metaChanged).toBe(2);
		expect(summary.description).toBe("2 changes: 2 meta");
	});
});
