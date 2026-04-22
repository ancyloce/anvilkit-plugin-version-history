import type { PageIR, PageIRNode } from "@anvilkit/core/types";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { applyDiff, diffIR } from "../diff.js";

const SEED = 20_260_422;
const PROP_KEYS = ["title", "count", "flag", "items", "config"] as const;

const scalarValueArb = fc.oneof(
	fc.string({ maxLength: 12 }),
	fc.integer({ min: -20, max: 20 }),
	fc.boolean(),
	fc.constant(null),
);

const objectValueArb = fc.dictionary(
	fc.constantFrom("a", "b", "c", "d"),
	scalarValueArb,
	{ maxKeys: 3 },
);

const valueArb = fc.oneof(
	scalarValueArb,
	fc.array(scalarValueArb, { maxLength: 3 }),
	objectValueArb,
	fc.array(objectValueArb, { maxLength: 2 }),
	fc.dictionary(fc.constantFrom("left", "right"), fc.array(scalarValueArb, { maxLength: 2 }), {
		maxKeys: 2,
	}),
);

const propsArb = fc.dictionary(fc.constantFrom(...PROP_KEYS), valueArb, {
	maxKeys: 4,
});

const irGen: fc.Arbitrary<PageIR> = fc
	.record({
		nodeCount: fc.integer({ min: 1, max: 50 }),
		rootProps: propsArb,
		nodeProps: fc.array(propsArb, { minLength: 49, maxLength: 49 }),
		parentSeeds: fc.array(fc.nat(10_000), { minLength: 49, maxLength: 49 }),
		typeSeeds: fc.array(fc.nat(10), { minLength: 49, maxLength: 49 }),
		idSalt: fc.nat(1_000_000),
	})
	.map(buildIR);

const pairPlanArb = fc.record({
	propMutations: fc.array(
		fc.record({
			nodeSeed: fc.nat(10_000),
			keySeed: fc.nat(10_000),
			mode: fc.constantFrom("set", "delete"),
			value: valueArb,
		}),
		{ maxLength: 4 },
	),
	adds: fc.array(
		fc.record({
			parentSeed: fc.nat(10_000),
			indexSeed: fc.nat(10_000),
			typeSeed: fc.nat(10),
			props: propsArb,
		}),
		{ maxLength: 2 },
	),
	removes: fc.array(fc.record({ nodeSeed: fc.nat(10_000) }), { maxLength: 2 }),
	moves: fc.array(
		fc.record({
			nodeSeed: fc.nat(10_000),
			parentSeed: fc.nat(10_000),
			indexSeed: fc.nat(10_000),
		}),
		{ maxLength: 2 },
	),
	reorders: fc.array(
		fc.record({
			parentSeed: fc.nat(10_000),
			offset: fc.integer({ min: 1, max: 4 }),
		}),
		{ maxLength: 2 },
	),
});

const irPairGen: fc.Arbitrary<readonly [PageIR, PageIR]> = fc
	.tuple(irGen, pairPlanArb)
	.map(([ir, plan]) => [ir, mutateIR(ir, plan)] as const);

describe("IR diff properties", () => {
	it("produces no diff when comparing a tree with itself", () => {
		fc.assert(
			fc.property(irGen, (ir) => diffIR(ir, ir).length === 0),
			{ numRuns: 500, seed: SEED },
		);
	}, 30_000);

	it("round-trips through applyDiff", () => {
		fc.assert(
			fc.property(irPairGen, ([a, b]) => {
				const diff = diffIR(a, b);
				expect(applyDiff(a, diff)).toEqual(b);
			}),
			{ numRuns: 500, seed: SEED },
		);
	}, 30_000);

	it("is deterministic for the same input pair", () => {
		fc.assert(
			fc.property(irPairGen, ([a, b]) => {
				expect(diffIR(a, b)).toEqual(diffIR(a, b));
			}),
			{ numRuns: 500, seed: SEED },
		);
	}, 30_000);
});

function buildIR(spec: {
	readonly nodeCount: number;
	readonly rootProps: Record<string, unknown>;
	readonly nodeProps: readonly Record<string, unknown>[];
	readonly parentSeeds: readonly number[];
	readonly typeSeeds: readonly number[];
	readonly idSalt: number;
}): PageIR {
	const root: MutableNode = {
		id: "root",
		type: "__root__",
		props: structuredClone(spec.rootProps),
		children: [],
	};
	const slots: Array<{ node: MutableNode; depth: number }> = [{ node: root, depth: 0 }];

	for (let index = 0; index < spec.nodeCount - 1; index += 1) {
		const candidates = slots.filter((entry) => entry.depth < 4);
		const parent = candidates[spec.parentSeeds[index]! % candidates.length]!;
		const node: MutableNode = {
			id: `node-${spec.idSalt}-${index}`,
			type: `Block${spec.typeSeeds[index]! % 4}`,
			props: structuredClone(spec.nodeProps[index]!),
			children: [],
		};
		parent.node.children.push(node);
		slots.push({ node, depth: parent.depth + 1 });
	}

	return toPageIR(root);
}

function mutateIR(
	ir: PageIR,
	plan: {
		readonly propMutations: readonly {
			readonly nodeSeed: number;
			readonly keySeed: number;
			readonly mode: "set" | "delete";
			readonly value: unknown;
		}[];
		readonly adds: readonly {
			readonly parentSeed: number;
			readonly indexSeed: number;
			readonly typeSeed: number;
			readonly props: Record<string, unknown>;
		}[];
		readonly removes: readonly { readonly nodeSeed: number }[];
		readonly moves: readonly {
			readonly nodeSeed: number;
			readonly parentSeed: number;
			readonly indexSeed: number;
		}[];
		readonly reorders: readonly {
			readonly parentSeed: number;
			readonly offset: number;
		}[];
	},
): PageIR {
	const root = toMutableNode(ir.root);
	let extraId = 0;

	for (const mutation of plan.propMutations) {
		const nodes = collectNodes(root);
		const target = nodes[mutation.nodeSeed % nodes.length]?.node;
		if (!target) {
			continue;
		}

		const keyPool = Array.from(
			new Set([...Object.keys(target.props), ...PROP_KEYS]),
		).sort((left, right) => left.localeCompare(right));
		const key = keyPool[mutation.keySeed % keyPool.length];
		if (!key) {
			continue;
		}

		if (mutation.mode === "delete") {
			delete target.props[key];
			continue;
		}

		target.props[key] = structuredClone(mutation.value);
	}

	for (const add of plan.adds) {
		if (countNodes(root) >= 50) {
			break;
		}

		const parents = collectNodes(root).filter((entry) => entry.depth < 4);
		const parent = parents[add.parentSeed % parents.length]?.node;
		if (!parent) {
			continue;
		}

		const nextNode: MutableNode = {
			id: `extra-${extraId}`,
			type: `Block${add.typeSeed % 4}`,
			props: structuredClone(add.props),
			children: [],
		};
		extraId += 1;
		const index = add.indexSeed % (parent.children.length + 1);
		parent.children.splice(index, 0, nextNode);
	}

	for (const removal of plan.removes) {
		const removable = collectNodes(root).filter((entry) => entry.parent);
		const target = removable[removal.nodeSeed % removable.length];
		if (!target?.parent) {
			continue;
		}

		target.parent.children.splice(target.index, 1);
	}

	for (const move of plan.moves) {
		const movable = collectNodes(root).filter((entry) => entry.parent);
		const target = movable[move.nodeSeed % movable.length];
		if (!target?.parent) {
			continue;
		}

		const blocked = new Set(collectNodes(target.node).map((entry) => entry.node));
		const maxDepth = subtreeHeight(target.node);
		const destinations = collectNodes(root).filter(
			(entry) =>
				!blocked.has(entry.node) &&
				entry.depth + maxDepth <= 4,
		);
		const destination = destinations[move.parentSeed % destinations.length]?.node;
		if (!destination) {
			continue;
		}

		target.parent.children.splice(target.index, 1);
		const index = move.indexSeed % (destination.children.length + 1);
		destination.children.splice(index, 0, target.node);
	}

	for (const reorder of plan.reorders) {
		const parents = collectNodes(root).filter(
			(entry) => entry.node.children.length >= 2,
		);
		const target = parents[reorder.parentSeed % parents.length]?.node;
		if (!target) {
			continue;
		}

		const offset = reorder.offset % target.children.length;
		if (offset === 0) {
			continue;
		}

		target.children = [
			...target.children.slice(offset),
			...target.children.slice(0, offset),
		];
	}

	return toPageIR(root);
}

interface MutableNode {
	id: string;
	type: string;
	props: Record<string, unknown>;
	children: MutableNode[];
}

function toMutableNode(node: PageIRNode): MutableNode {
	return {
		id: node.id,
		type: node.type,
		props: structuredClone(node.props),
		children: (node.children ?? []).map((child) => toMutableNode(child)),
	};
}

function toPageIR(root: MutableNode): PageIR {
	return {
		version: "1",
		root: toPageNode(root),
		assets: [],
		metadata: {},
	};
}

function toPageNode(node: MutableNode): PageIRNode {
	return {
		id: node.id,
		type: node.type,
		props: structuredClone(node.props),
		...(node.children.length > 0
			? { children: node.children.map((child) => toPageNode(child)) }
			: {}),
	};
}

function collectNodes(
	root: MutableNode,
	depth = 0,
	parent?: MutableNode,
	index = -1,
): Array<{
	node: MutableNode;
	depth: number;
	parent?: MutableNode;
	index: number;
}> {
	return [
		{ node: root, depth, parent, index },
		...root.children.flatMap((child, childIndex) =>
			collectNodes(child, depth + 1, root, childIndex),
		),
	];
}

function countNodes(root: MutableNode): number {
	return collectNodes(root).length;
}

function subtreeHeight(node: MutableNode): number {
	if (node.children.length === 0) {
		return 0;
	}

	return 1 + Math.max(...node.children.map((child) => subtreeHeight(child)));
}
