import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Targeted exported interfaces that must carry source-level TSDoc — both the
 * interface declaration itself and every one of its members. This is a
 * static documentation-coverage guard for the "uneven source-level TSDoc"
 * finding: each entry was undocumented (in whole or in part) before the fix,
 * so this suite is red on the pre-fix source and green afterwards.
 */
const TARGETS: ReadonlyArray<{
	readonly file: string;
	readonly interfaces: readonly string[];
}> = [
	{
		file: "ui/SaveSnapshotButton.tsx",
		interfaces: ["SaveSnapshotButtonProps"],
	},
	{ file: "ui/SnapshotList.tsx", interfaces: ["SnapshotListProps"] },
	{
		file: "ui/VersionHistoryUI.tsx",
		interfaces: ["RestoreConflictEvent", "VersionHistoryUIProps"],
	},
	{ file: "ui/DiffView.tsx", interfaces: ["DiffViewProps"] },
	{
		file: "ui/SnapshotHistoryModal.tsx",
		interfaces: ["SnapshotHistoryModalProps"],
	},
	{ file: "plugin.ts", interfaces: ["CreateVersionHistoryPluginOptions"] },
	{ file: "types/types.ts", interfaces: ["SnapshotAdapter"] },
];

function parseFile(relativePath: string): ts.SourceFile {
	const absolute = resolve(SRC_ROOT, relativePath);
	const text = readFileSync(absolute, "utf8");
	return ts.createSourceFile(
		absolute,
		text,
		ts.ScriptTarget.Latest,
		/* setParentNodes */ true,
		relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
}

/**
 * `true` when `node` is immediately preceded by a `/** … *\/` JSDoc block.
 * Reads the raw leading-comment ranges (rather than the TS JSDoc binder) so
 * the assertion mirrors exactly what a human reading the source would see.
 */
function hasTsDoc(node: ts.Node, source: ts.SourceFile): boolean {
	const fullText = source.getFullText();
	const ranges =
		ts.getLeadingCommentRanges(fullText, node.getFullStart()) ?? [];
	return ranges.some(
		(range) =>
			range.kind === ts.SyntaxKind.MultiLineCommentTrivia &&
			fullText.slice(range.pos, range.end).startsWith("/**"),
	);
}

function findInterface(
	source: ts.SourceFile,
	name: string,
): ts.InterfaceDeclaration | undefined {
	let found: ts.InterfaceDeclaration | undefined;
	source.forEachChild((node) => {
		if (ts.isInterfaceDeclaration(node) && node.name.text === name) {
			found = node;
		}
	});
	return found;
}

describe("source-level TSDoc coverage", () => {
	for (const target of TARGETS) {
		const source = parseFile(target.file);

		for (const interfaceName of target.interfaces) {
			const declaration = findInterface(source, interfaceName);

			it(`${target.file}: ${interfaceName} is present`, () => {
				expect(
					declaration,
					`interface ${interfaceName} not found in ${target.file}`,
				).toBeDefined();
			});

			it(`${target.file}: ${interfaceName} has interface-level TSDoc`, () => {
				expect(declaration && hasTsDoc(declaration, source)).toBe(true);
			});

			it(`${target.file}: every ${interfaceName} member has TSDoc`, () => {
				const undocumented: string[] = [];
				for (const member of declaration?.members ?? []) {
					if (
						!ts.isPropertySignature(member) &&
						!ts.isMethodSignature(member)
					) {
						continue;
					}
					if (!hasTsDoc(member, source)) {
						undocumented.push(member.name.getText(source));
					}
				}
				expect(undocumented).toEqual([]);
			});
		}
	}
});
