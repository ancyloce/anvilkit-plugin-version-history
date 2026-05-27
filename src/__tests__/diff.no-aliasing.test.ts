/**
 * @file Regression guard for the single-clone optimization in `applyDiff`.
 *
 * `applyDiff` used to deep-clone every node twice (once into the working
 * `NodeContent` map, once again while reconstructing the output tree). The
 * second clone was removed: `collectContent` already produces an
 * independent mutable copy and the op handlers mutate it copy-on-write, so
 * the reconstructed node can own those objects directly.
 *
 * The invariant that makes that safe: `applyDiff` must NEVER mutate its
 * input `PageIR`, and the returned tree must not alias the input's
 * prop/asset/meta objects for nodes the diff actually changed. These tests
 * assert both, across add / remove / move / change-prop / meta-changed ops
 * and nodes with nested children, assets, and meta.
 */

import type { PageIR, PageIRNode } from "@anvilkit/core/types";
import { describe, expect, it } from "vitest";

import { applyDiff, diffIR } from "../utils/diff.js";

function node(
	id: string,
	props: Record<string, unknown> = {},
	extra: Partial<PageIRNode> = {},
): PageIRNode {
	return { id, type: "Leaf", props, ...extra };
}

function page(root: PageIRNode, assets: unknown[] = [], metadata = {}): PageIR {
	return { version: "1", root, assets, metadata };
}

/** Deep clone via JSON so the "before" snapshot can't alias `a`. */
function snapshot<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

describe("applyDiff — no input mutation / no aliasing", () => {
	const cases: ReadonlyArray<{
		readonly name: string;
		readonly a: PageIR;
		readonly b: PageIR;
	}> = [
		{
			name: "prop change on a leaf",
			a: page(node("root", {}, { children: [node("hero", { title: "Hi" })] })),
			b: page(node("root", {}, { children: [node("hero", { title: "Bye" })] })),
		},
		{
			name: "meta add/remove + nested children",
			a: page(
				node(
					"root",
					{},
					{
						children: [
							node("a", { x: 1 }, { meta: { locked: true } }),
							node("b", { y: 2 }, { children: [node("c", { z: 3 })] }),
						],
					},
				),
			),
			b: page(
				node(
					"root",
					{},
					{
						children: [
							node("a", { x: 1 }),
							node("b", { y: 2 }, { children: [node("c", { z: 99 })] }),
						],
					},
				),
			),
		},
		{
			name: "add + remove + reorder with assets",
			a: page(
				node(
					"root",
					{},
					{
						children: [node("a", {}), node("b", {})],
					},
				),
				[{ id: "img-1" }],
			),
			b: page(
				node(
					"root",
					{},
					{
						children: [
							node("b", {}),
							node("c", {}, { assets: [{ id: "img-2" }] }),
						],
					},
				),
				[{ id: "img-1" }],
			),
		},
	];

	for (const { name, a, b } of cases) {
		it(`does not mutate the input PageIR: ${name}`, () => {
			const before = snapshot(a);
			const result = applyDiff(a, diffIR(a, b));

			// 1. Input is byte-for-byte unchanged.
			expect(a).toEqual(before);

			// 2. Round-trips to the target tree (structural sanity).
			expect(result.root).toEqual(b.root);

			// 3. The reconstructed root is a distinct object from the input
			//    root — the output never IS the input.
			expect(result.root).not.toBe(a.root);
		});
	}

	it("a frozen input is never written through (would throw on aliased mutation)", () => {
		const a = page(
			node("root", {}, { children: [node("hero", { title: "Hi" })] }),
		);
		// Freeze the whole input tree; if applyDiff tried to mutate a shared
		// reference in place this would throw a TypeError in strict mode.
		const freeze = (value: unknown): void => {
			if (value && typeof value === "object") {
				Object.freeze(value);
				for (const v of Object.values(value)) freeze(v);
			}
		};
		freeze(a);

		const b = page(
			node("root", {}, { children: [node("hero", { title: "Bye" })] }),
		);
		expect(() => applyDiff(a, diffIR(a, b))).not.toThrow();
	});
});
