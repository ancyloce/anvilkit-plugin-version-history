import type { PageIR, PageIRNode, PageIRNodeMeta } from "@anvilkit/core/types";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { applyDiff, diffIR } from "../diff.js";

const SEED = 20_260_422;
const PROP_KEYS = ["title", "count", "flag", "items", "config"] as const;
const META_KEYS = ["locked", "owner", "version", "notes"] as const;
type MetaKey = (typeof META_KEYS)[number];

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

const semverArb = fc
	.tuple(fc.nat({ max: 99 }), fc.nat({ max: 99 }), fc.nat({ max: 99 }))
	.map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

const metaArb: fc.Arbitrary<PageIRNodeMeta | undefined> = fc.option(
	fc.record(
		{
			locked: fc.option(fc.boolean(), { nil: undefined }),
			owner: fc.option(fc.string({ maxLength: 16 }), { nil: undefined }),
			version: fc.option(semverArb, { nil: undefined }),
			notes: fc.option(fc.string({ maxLength: 32 }), { nil: undefined }),
		},
		{ requiredKeys: [] },
	),
	{ nil: undefined, freq: 2 },
);

const irGen: fc.Arbitrary<PageIR> = fc
	.record({
		nodeCount: fc.integer({ min: 1, max: 50 }),
		rootProps: propsArb,
		nodeProps: fc.array(propsArb, { minLength: 49, maxLength: 49 }),
		nodeMetas: fc.array(metaArb, { minLength: 50, maxLength: 50 }),
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
	metaMutations: fc.array(
		fc.record({
			nodeSeed: fc.nat(10_000),
			keySeed: fc.nat(10_000),
			mode: fc.constantFrom("set", "delete"),
			value: fc.oneof(
				fc.boolean(),
				fc.string({ maxLength: 16 }),
				semverArb,
			),
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
	readonly nodeMetas: readonly (PageIRNodeMeta | undefined)[];
	readonly parentSeeds: readonly number[];
	readonly typeSeeds: readonly number[];
	readonly idSalt: number;
}): PageIR {
	const root: MutableNode = {
		id: "root",
		type: "__root__",
		props: structuredClone(spec.rootProps),
		children: [],
		meta: cloneMeta(spec.nodeMetas[0]),
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
			meta: cloneMeta(spec.nodeMetas[index + 1]),
		};
		parent.node.children.push(node);
		slots.push({ node, depth: parent.depth + 1 });
	}

	return toPageIR(root);
}

function cloneMeta(
	meta: PageIRNodeMeta | undefined,
): Record<string, unknown> | undefined {
	if (meta === undefined) {
		return undefined;
	}
	const cloned = structuredClone(meta) as Record<string, unknown>;
	// Drop keys whose value is undefined to keep meta object shape stable
	// (avoid `{ owner: undefined }` round-tripping differently from `{}`).
	for (const key of Object.keys(cloned)) {
		if (cloned[key] === undefined) {
			delete cloned[key];
		}
	}
	if (Object.keys(cloned).length === 0) {
		return undefined;
	}
	return cloned;
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
		readonly metaMutations: readonly {
			readonly nodeSeed: number;
			readonly keySeed: number;
			readonly mode: "set" | "delete";
			readonly value: boolean | string;
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

	for (const mutation of plan.metaMutations) {
		const nodes = collectNodes(root);
		const target = nodes[mutation.nodeSeed % nodes.length]?.node;
		if (!target) {
			continue;
		}

		const key = META_KEYS[mutation.keySeed % META_KEYS.length] as MetaKey;

		if (mutation.mode === "delete") {
			if (target.meta !== undefined) {
				const next = { ...target.meta };
				delete next[key];
				target.meta = Object.keys(next).length === 0 ? undefined : next;
			}
			continue;
		}

		const coerced = coerceMetaValue(key, mutation.value);
		const current = target.meta ?? {};
		target.meta = { ...current, [key]: coerced };
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
	meta?: Record<string, unknown>;
}

function toMutableNode(node: PageIRNode): MutableNode {
	return {
		id: node.id,
		type: node.type,
		props: structuredClone(node.props),
		children: (node.children ?? []).map((child) => toMutableNode(child)),
		...(node.meta !== undefined
			? { meta: structuredClone(node.meta) as Record<string, unknown> }
			: {}),
	};
}

function coerceMetaValue(key: MetaKey, raw: boolean | string): unknown {
	if (key === "locked") {
		return typeof raw === "boolean" ? raw : raw.length > 0;
	}
	if (key === "version") {
		// Force a semver-shaped string so `validator` would accept it
		// downstream — fuzz mutations should produce documents the
		// runtime would actually allow.
		return typeof raw === "string" && /^\d+\.\d+\.\d+/.test(raw)
			? raw
			: "1.0.0";
	}
	// owner / notes — string fields, capped at 32/64 in the arb above.
	return typeof raw === "string" ? raw : String(raw);
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
		...(node.meta !== undefined
			? { meta: structuredClone(node.meta) as PageIRNodeMeta }
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
