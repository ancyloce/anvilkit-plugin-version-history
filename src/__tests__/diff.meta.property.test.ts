/**
 * @file Focused 200-run property suite for meta-only mutations
 * (M10-T4 / `phase6-009`). Faster signal when a meta-related bug
 * lands than the full 500-pair `diff.property.test.ts` — narrowed
 * arbitraries produce dense meta deltas without prop / structural
 * noise.
 *
 * Seed `20_260_429` is independent from the main fuzz suite's seed
 * `20_260_422`. Bumping it requires a documented changeset.
 */

import type { PageIR, PageIRNode, PageIRNodeMeta } from "@anvilkit/core/types";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { applyDiff, diffIR, summarizeDiff } from "../diff.js";

const SEED = 20_260_429;
const NUM_RUNS = 200;

const semverArb = fc
	.tuple(fc.nat({ max: 50 }), fc.nat({ max: 50 }), fc.nat({ max: 50 }))
	.map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

const metaArb: fc.Arbitrary<PageIRNodeMeta | undefined> = fc.option(
	fc
		.record(
			{
				locked: fc.option(fc.boolean(), { nil: undefined }),
				owner: fc.option(fc.string({ maxLength: 16 }), { nil: undefined }),
				version: fc.option(semverArb, { nil: undefined }),
				notes: fc.option(fc.string({ maxLength: 24 }), { nil: undefined }),
			},
			{ requiredKeys: [] },
		)
		.map((meta) => {
			const cleaned: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(meta)) {
				if (value !== undefined) {
					cleaned[key] = value;
				}
			}
			return Object.keys(cleaned).length === 0
				? undefined
				: (cleaned as PageIRNodeMeta);
		}),
	{ nil: undefined, freq: 2 },
);

interface SimpleSpec {
	readonly nodeCount: number;
	readonly metas: readonly (PageIRNodeMeta | undefined)[];
}

const simpleSpecArb: fc.Arbitrary<SimpleSpec> = fc
	.record({
		nodeCount: fc.integer({ min: 1, max: 6 }),
		metas: fc.array(metaArb, { minLength: 7, maxLength: 7 }),
	})
	.filter((spec) => spec.metas.length >= spec.nodeCount + 1);

function buildSimpleIR(spec: SimpleSpec): PageIR {
	const root: PageIRNode = {
		id: "root",
		type: "Root",
		props: {},
		...(spec.metas[0] !== undefined ? { meta: spec.metas[0] } : {}),
		...(spec.nodeCount > 0
			? {
					children: Array.from({ length: spec.nodeCount }, (_, idx) => {
						const meta = spec.metas[idx + 1];
						return {
							id: `n-${idx}`,
							type: "Leaf",
							props: {},
							...(meta !== undefined ? { meta } : {}),
						} satisfies PageIRNode;
					}),
				}
			: {}),
	};
	return {
		version: "1",
		root,
		assets: [],
		metadata: {},
	};
}

const irPairArb: fc.Arbitrary<readonly [PageIR, PageIR]> = fc
	.tuple(simpleSpecArb, simpleSpecArb)
	.map(
		([specA, specB]) => [buildSimpleIR(specA), buildSimpleIR(specB)] as const,
	)
	// Force the trees to share node IDs (only meta differs across pairs)
	// so we exercise the meta-changed branch — not add/remove.
	.map(([a, b]) => {
		if (a.root.children?.length !== b.root.children?.length) {
			return [a, a] as const;
		}
		return [a, b] as const;
	});

describe("diff meta-only properties (200 runs, seed 20_260_429)", () => {
	it("applyDiff(a, diffIR(a, b)) ≡ b for meta-only pairs", () => {
		fc.assert(
			fc.property(irPairArb, ([a, b]) => {
				const diff = diffIR(a, b);
				expect(applyDiff(a, diff)).toEqual(b);
			}),
			{ numRuns: NUM_RUNS, seed: SEED },
		);
	});

	it("summarizeDiff.metaChanged matches the count of meta-changed ops", () => {
		fc.assert(
			fc.property(irPairArb, ([a, b]) => {
				const diff = diffIR(a, b);
				const opCount = diff.filter((op) => op.kind === "meta-changed").length;
				const summarized = summarizeDiff(diff);
				expect(summarized.metaChanged ?? 0).toBe(opCount);
			}),
			{ numRuns: NUM_RUNS, seed: SEED },
		);
	});

	it("diffIR(a, a) emits no meta ops on identical trees", () => {
		fc.assert(
			fc.property(simpleSpecArb, (spec) => {
				const ir = buildSimpleIR(spec);
				const diff = diffIR(ir, ir);
				expect(diff.filter((op) => op.kind === "meta-changed")).toEqual([]);
			}),
			{ numRuns: NUM_RUNS, seed: SEED },
		);
	});
});
