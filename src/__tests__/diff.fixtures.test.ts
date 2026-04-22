import type { PageIR, PageIRNode } from "@anvilkit/core/types";
import { describe, expect, it } from "vitest";

import {
	DiffApplyError,
	applyDiff,
	diffIR,
	summarizeDiff,
	type IRDiff,
} from "../diff.js";

interface FixtureCase {
	readonly name: string;
	readonly a: PageIR;
	readonly b: PageIR;
	readonly counts: {
		readonly addNode: number;
		readonly removeNode: number;
		readonly moveNode: number;
		readonly changeChildren: number;
		readonly changeProp: number;
	};
	readonly summary: {
		readonly added: number;
		readonly removed: number;
		readonly moved: number;
		readonly changed: number;
		readonly description: string;
	};
}

describe("diffIR fixtures", () => {
	const fixtures: readonly FixtureCase[] = [
		{
			name: "identical trees",
			a: page([leaf("hero", { title: "Hello" })]),
			b: page([leaf("hero", { title: "Hello" })]),
			counts: {
				addNode: 0,
				removeNode: 0,
				moveNode: 0,
				changeChildren: 0,
				changeProp: 0,
			},
			summary: {
				added: 0,
				removed: 0,
				moved: 0,
				changed: 0,
				description: "No changes",
			},
		},
		{
			name: "single prop change",
			a: page([leaf("hero", { title: "Hello" })]),
			b: page([leaf("hero", { title: "Updated" })]),
			counts: {
				addNode: 0,
				removeNode: 0,
				moveNode: 0,
				changeChildren: 0,
				changeProp: 1,
			},
			summary: {
				added: 0,
				removed: 0,
				moved: 0,
				changed: 1,
				description: "1 change: 1 changed",
			},
		},
		{
			name: "single add",
			a: page([leaf("hero", { title: "Hello" })]),
			b: page([
				leaf("hero", { title: "Hello" }),
				leaf("cta", { label: "Start" }),
			]),
			counts: {
				addNode: 1,
				removeNode: 0,
				moveNode: 0,
				changeChildren: 1,
				changeProp: 0,
			},
			summary: {
				added: 1,
				removed: 0,
				moved: 0,
				changed: 1,
				description: "2 changes: 1 added, 1 changed",
			},
		},
		{
			name: "single remove",
			a: page([
				leaf("hero", { title: "Hello" }),
				leaf("cta", { label: "Start" }),
			]),
			b: page([leaf("hero", { title: "Hello" })]),
			counts: {
				addNode: 0,
				removeNode: 1,
				moveNode: 0,
				changeChildren: 1,
				changeProp: 0,
			},
			summary: {
				added: 0,
				removed: 1,
				moved: 0,
				changed: 1,
				description: "2 changes: 1 removed, 1 changed",
			},
		},
		{
			name: "single move plus prop change",
			a: page([
				branch("left", {}, [leaf("card", { tone: "muted" })]),
				branch("right"),
			]),
			b: page([
				branch("left"),
				branch("right", {}, [leaf("card", { tone: "bright" })]),
			]),
			counts: {
				addNode: 0,
				removeNode: 0,
				moveNode: 1,
				changeChildren: 2,
				changeProp: 1,
			},
			summary: {
				added: 0,
				removed: 0,
				moved: 1,
				changed: 3,
				description: "4 changes: 1 moved, 3 changed",
			},
		},
	];

	for (const fixture of fixtures) {
		it(fixture.name, () => {
			const diff = diffIR(fixture.a, fixture.b);

			expect(countOps(diff)).toEqual(fixture.counts);
			expect(summarizeDiff(diff)).toEqual(fixture.summary);

			const applied = applyDiff(fixture.a, diff);
			expect(applied).toEqual(fixture.b);
			expect(Object.isFrozen(applied)).toBe(true);
			expect(Object.isFrozen(applied.root)).toBe(true);
			expect(Object.isFrozen(applied.root.props)).toBe(true);
		});
	}

	it("applies ancestor moves without replaying redundant descendant moves", () => {
		const a = page([
			branch("frame", {}, [leaf("nested", { state: "before" })]),
			leaf("sibling", { state: "steady" }),
		]);
		const b = page([
			leaf("sibling", { state: "steady" }),
			branch("frame", {}, [leaf("nested", { state: "before" })]),
		]);

		const diff = diffIR(a, b);
		expect(countOps(diff).moveNode).toBe(3);
		expect(applyDiff(a, diff)).toEqual(b);
	});

	it("rehomes a child through change-children when its pointer path stays the same", () => {
		const a = page([
			branch("left", {}, [leaf("keep", { slot: "left" })]),
			branch("right", {}, [leaf("migrates", { slot: "right" })]),
		]);
		const b = page([
			branch("right"),
			branch("left", {}, [leaf("migrates", { slot: "right" })]),
		]);

		expect(applyDiff(a, diffIR(a, b))).toEqual(b);
	});
});

describe("applyDiff errors", () => {
	it("throws when removing the root node", () => {
		const ir = page([leaf("hero", { title: "Hello" })]);

		expect(() =>
			applyDiff(ir, [
				{
					kind: "remove-node",
					path: "/root",
					nodeId: "root",
				},
			]),
		).toThrowError(DiffApplyError);
	});

	it("throws when a prop change does not match the expected before value", () => {
		const ir = page([leaf("hero", { title: "Hello" })]);

		expect(() =>
			applyDiff(ir, [
				{
					kind: "change-prop",
					path: "/root/children/0/props",
					key: "title",
					before: "Wrong",
					after: "Updated",
				},
			]),
		).toThrowError(DiffApplyError);
	});

	it("throws when removing a path with the wrong node id", () => {
		const ir = page([leaf("hero", { title: "Hello" })]);

		expect(() =>
			applyDiff(ir, [
				{
					kind: "remove-node",
					path: "/root/children/0",
					nodeId: "wrong",
				},
			]),
		).toThrowError(DiffApplyError);
	});

	it("throws when adding a second root or a duplicate sibling id", () => {
		const ir = page([leaf("hero", { title: "Hello" })]);

		expect(() =>
			applyDiff(ir, [
				{
					kind: "add-node",
					path: "/root",
					node: leaf("new-root"),
				},
			]),
		).toThrowError(DiffApplyError);

		expect(() =>
			applyDiff(ir, [
				{
					kind: "add-node",
					path: "/root/children/1",
					node: leaf("hero"),
				},
			]),
		).toThrowError(DiffApplyError);
	});

	it("throws when a change-children reorder would create a cycle", () => {
		const ir = page([branch("frame", {}, [leaf("child", { title: "Hello" })])]);

		expect(() =>
			applyDiff(ir, [
				{
					kind: "change-children",
					path: "/root/children/0/children/0/children",
					before: [],
					after: ["frame"],
				},
			]),
		).toThrowError(DiffApplyError);
	});

	it("throws when a move references the root or an unknown node id", () => {
		const ir = page([branch("frame", {}, [leaf("child", { title: "Hello" })])]);

		expect(() =>
			applyDiff(ir, [
				{
					kind: "move-node",
					from: "/root",
					to: "/root/children/0",
					nodeId: "root",
				},
			]),
		).toThrowError(DiffApplyError);

		expect(() =>
			applyDiff(ir, [
				{
					kind: "move-node",
					from: "/root/children/0",
					to: "/root/children/1",
					nodeId: "missing",
				},
			]),
		).toThrowError(DiffApplyError);

		expect(() =>
			applyDiff(ir, [
				{
					kind: "move-node",
					from: "/root/children/0",
					to: "/root/1",
					nodeId: "frame",
				},
			]),
		).toThrowError(DiffApplyError);

		expect(() =>
			applyDiff(ir, [
				{
					kind: "move-node",
					from: "/root/children/0",
					to: "/root/children/nope",
					nodeId: "frame",
				},
			]),
		).toThrowError(DiffApplyError);
	});

	it("throws when a child reorder references a missing node", () => {
		const ir = page([leaf("hero", { title: "Hello" })]);

		expect(() =>
			applyDiff(ir, [
				{
					kind: "change-children",
					path: "/root/children",
					before: ["hero"],
					after: ["missing"],
				},
			]),
		).toThrowError(DiffApplyError);
	});

	it("throws when a child reorder contains duplicate ids", () => {
		const ir = page([
			leaf("hero", { title: "Hello" }),
			leaf("cta", { title: "Start" }),
		]);

		expect(() =>
			applyDiff(ir, [
				{
					kind: "change-children",
					path: "/root/children",
					before: ["hero", "cta"],
					after: ["hero", "hero"],
				},
			]),
		).toThrowError(DiffApplyError);
	});

	it("throws when a path is not a valid JSON pointer", () => {
		const ir = page([leaf("hero", { title: "Hello" })]);

		expect(() =>
			applyDiff(ir, [
				{
					kind: "change-prop",
					path: "root/props",
					key: "title",
					before: undefined,
					after: "Updated",
				},
			] as IRDiff),
		).toThrowError(DiffApplyError);
	});

	it("throws on malformed pointer segments", () => {
		const ir = page([leaf("hero", { title: "Hello" })]);

		expect(() =>
			applyDiff(ir, [
				{
					kind: "change-prop",
					path: "/bad/props",
					key: "title",
					before: undefined,
					after: "Updated",
				},
			]),
		).toThrowError(DiffApplyError);

		expect(() =>
			applyDiff(ir, [
				{
					kind: "change-prop",
					path: "/root/bad/0/props",
					key: "title",
					before: undefined,
					after: "Updated",
				},
			]),
		).toThrowError(DiffApplyError);

		expect(() =>
			applyDiff(ir, [
				{
					kind: "change-prop",
					path: "/root/children/props",
					key: "title",
					before: undefined,
					after: "Updated",
				},
			]),
		).toThrowError(DiffApplyError);

		expect(() =>
			applyDiff(ir, [
				{
					kind: "change-prop",
					path: "/root/children/nope/props",
					key: "title",
					before: undefined,
					after: "Updated",
				},
			]),
		).toThrowError(DiffApplyError);

		expect(() =>
			applyDiff(ir, [
				{
					kind: "change-prop",
					path: "/root/children/9/props",
					key: "title",
					before: undefined,
					after: "Updated",
				},
			]),
		).toThrowError(DiffApplyError);

		expect(() =>
			applyDiff(ir, [
				{
					kind: "change-prop",
					path: "/root/children/0",
					key: "title",
					before: "Hello",
					after: "Updated",
				},
			]),
		).toThrowError(DiffApplyError);

		expect(() =>
			applyDiff(ir, [
				{
					kind: "remove-node",
					path: "/root/children/9",
					nodeId: "hero",
				},
			]),
		).toThrowError(DiffApplyError);

		expect(() =>
			applyDiff(ir, [
				{
					kind: "remove-node",
					path: "/root/children/nope",
					nodeId: "hero",
				},
			]),
		).toThrowError(DiffApplyError);
	});
});

function page(children: readonly PageIRNode[]): PageIR {
	return {
		version: "1",
		root: branch("root", {}, children, "__root__"),
		assets: [],
		metadata: {},
	};
}

function branch(
	id: string,
	props: Record<string, unknown> = {},
	children: readonly PageIRNode[] = [],
	type = "Branch",
): PageIRNode {
	return {
		id,
		type,
		props,
		...(children.length > 0 ? { children } : {}),
	};
}

function leaf(id: string, props: Record<string, unknown> = {}): PageIRNode {
	return {
		id,
		type: "Leaf",
		props,
	};
}

function countOps(diff: IRDiff) {
	return {
		addNode: diff.filter((op) => op.kind === "add-node").length,
		removeNode: diff.filter((op) => op.kind === "remove-node").length,
		moveNode: diff.filter((op) => op.kind === "move-node").length,
		changeChildren: diff.filter((op) => op.kind === "change-children").length,
		changeProp: diff.filter((op) => op.kind === "change-prop").length,
	};
}
