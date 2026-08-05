/**
 * @file PLAN-0025 Phase 3.5 (P3.5-03) — Puck-native v2 snapshots.
 *
 * The plugin persists `PageIR` built by the HOST (`buildIR`) and plans
 * restores PURELY — the host owns the dispatch. Its v2 obligations,
 * locked here:
 *
 * 1. source scan: no sidecar / sidecar-editor-command reference
 *    (plan §15 gate 3, per package);
 * 2. the full chain a v2 document travels — `puckDataToIR` → snapshot
 *    save → restore plan → `irToPuckData` — preserves §5.1 node
 *    carriers (`appearance`/`interactions`/`bindings`) and the
 *    `designSystem` root prop; the diff summarizer handles
 *    appearance-only changes without choking;
 * 3. the restore plan returns the stored IR UNMODIFIED — which is the
 *    migration seam: a host restoring a v1-era (sidecar-carrying)
 *    snapshot into a v2 editor migrates the returned IR/Data before
 *    dispatching. The migration function itself is a Phase 5
 *    deliverable (`migrateToPuckNativeV2`); this seam is what it
 *    plugs into.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { irToPuckData, puckDataToIR } from "@anvilkit/ir";
import type { Config, Data } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import { inMemoryAdapter } from "../adapters/in-memory.js";
import { diffIR } from "../utils/diff.js";
import { hashPageIR } from "../utils/hash.js";
import { prepareRestore } from "../utils/restore.js";

const FORBIDDEN = [
	"__anvilkit",
	"readAuthoringState",
	"writeAuthoringState",
	"ANVILKIT_AUTHORING_KEY",
	"EditorCommandPort",
	"applyEditorCommand",
	'"replaceRoot"',
] as const;

function sourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "__tests__" || entry.name === "testing") continue;
			files.push(...sourceFiles(path));
			continue;
		}
		if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
			files.push(path);
		}
	}
	return files;
}

const config: Config = {
	components: { Hero: { fields: {}, render: () => null } },
} as unknown as Config;

const appearance = {
	version: "1",
	targets: { root: { style: { base: { layout: { display: "flex" } } } } },
};

function v2Document(display: string): Data {
	return {
		content: [
			{
				type: "Hero",
				props: {
					id: "hero-1",
					title: "Hello",
					appearance: {
						version: "1",
						targets: {
							root: { style: { base: { layout: { display } } } },
						},
					},
					interactions: [{ id: "i-1", trigger: "click" }],
					bindings: [{ id: "b-1", nodeId: "hero-1" }],
				},
			},
		],
		root: {
			props: {
				title: "Page",
				designSystem: {
					version: "1",
					breakpoints: [],
					tokens: {},
					tokenModes: { light: { id: "light", name: "Light" } },
					defaultTokenMode: "light",
					styleDefinitions: {},
				},
			},
		},
		zones: {},
	} as unknown as Data;
}

describe("Puck-native v2 compliance (P3.5-03)", () => {
	it("no source file references the sidecar or sidecar editor commands", () => {
		const offenders: string[] = [];
		for (const file of sourceFiles(join(__dirname, ".."))) {
			const source = readFileSync(file, "utf8");
			for (const marker of FORBIDDEN) {
				if (source.includes(marker)) offenders.push(`${file}: ${marker}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it("a v2 document round-trips save → restore with carriers and designSystem intact", () => {
		const data = v2Document("flex");
		const ir = puckDataToIR(data, config);
		const adapter = inMemoryAdapter();
		const id = adapter.save(ir, { label: "v2-doc" });

		const stored = adapter.load(id);
		expect(stored).toBeDefined();
		// The migration seam: `prepareRestore` hands back the stored IR
		// UNTOUCHED for the host to (optionally migrate and) dispatch.
		const planned = prepareRestore({
			snapshotIR: stored as never,
			currentIR: ir as never,
			expectedBaseHash: hashPageIR(ir as never),
		});
		expect(planned).toBe(stored);
		const restored = irToPuckData(planned) as unknown as {
			content: { props: Record<string, unknown> }[];
			root: { props: Record<string, unknown> };
		};

		expect(restored.content[0]?.props.appearance).toEqual(appearance);
		expect(restored.content[0]?.props.interactions).toEqual([
			{ id: "i-1", trigger: "click" },
		]);
		expect(restored.content[0]?.props.bindings).toEqual([
			{ id: "b-1", nodeId: "hero-1" },
		]);
		expect(restored.root.props.designSystem).toEqual(
			(
				v2Document("flex") as unknown as {
					root: { props: Record<string, unknown> };
				}
			).root.props.designSystem,
		);
	});

	it("diffing two snapshots that differ only in appearance reports a change, not a crash", () => {
		const before = puckDataToIR(v2Document("flex"), config);
		const after = puckDataToIR(v2Document("grid"), config);
		const diff = diffIR(before, after);
		// An appearance-only change surfaces as a precise prop-level diff
		// entry, exactly like any other prop.
		const entries = diff as readonly { kind: string; key?: string }[];
		expect(
			entries.some(
				(entry) => entry.kind === "change-prop" && entry.key === "appearance",
			),
		).toBe(true);
	});
});
