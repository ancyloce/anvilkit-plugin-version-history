import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The JS-based compiler API (npm alias of typescript@6.0.3): the native tsgo
// typescript@7 pinned workspace-wide no longer ships ts.ScriptTarget import ts from "typescript"; co.
import ts from "typescript-jsapi";
import { describe, expect, it } from "vitest";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TYPES_PATH = resolve(PKG_ROOT, "src/types/types.ts");
const README_PATH = resolve(PKG_ROOT, "README.md");

/**
 * Regression guard for Low-priority finding #4: `SnapshotAdapter.subscribe`,
 * `SnapshotAdapter.presence`, and the `SnapshotAdapterPresence` channel are
 * optional members that the bundled reference adapters intentionally do not
 * implement. The source TSDoc and README must document them explicitly as
 * host / collaboration-adapter owned so the typed-but-unimplemented surface is
 * not mistaken for a gap. The generic L1 docs ("for collaborative adapters",
 * "Omitted by local/single-user adapters") do NOT satisfy these assertions,
 * so this suite is red on the pre-fix source and green afterwards.
 */

function parseTypes(): ts.SourceFile {
	const text = readFileSync(TYPES_PATH, "utf8");
	return ts.createSourceFile(
		TYPES_PATH,
		text,
		ts.ScriptTarget.Latest,
		/* setParentNodes */ true,
		ts.ScriptKind.TS,
	);
}

/**
 * Strip JSDoc framing (`/**`, `*\/`, per-line `*`) and collapse all whitespace
 * to single spaces, so phrase assertions match across the comment's line wraps.
 */
function normalizeDoc(text: string): string {
	return text
		.replace(/\/\*\*|\*\//g, " ")
		.replace(/^\s*\*/gm, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Normalized text of the `/** … *\/` JSDoc block(s) leading `node`.
 */
function leadingTsDoc(node: ts.Node, source: ts.SourceFile): string {
	const fullText = source.getFullText();
	const ranges =
		ts.getLeadingCommentRanges(fullText, node.getFullStart()) ?? [];
	const raw = ranges
		.filter(
			(range) =>
				range.kind === ts.SyntaxKind.MultiLineCommentTrivia &&
				fullText.slice(range.pos, range.end).startsWith("/**"),
		)
		.map((range) => fullText.slice(range.pos, range.end))
		.join("\n");
	return normalizeDoc(raw);
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

function memberDoc(
	source: ts.SourceFile,
	interfaceName: string,
	memberName: string,
): string {
	const declaration = findInterface(source, interfaceName);
	expect(
		declaration,
		`interface ${interfaceName} not found in types.ts`,
	).toBeDefined();
	const member = declaration?.members.find(
		(m) =>
			(ts.isPropertySignature(m) || ts.isMethodSignature(m)) &&
			m.name.getText(source) === memberName,
	);
	expect(
		member,
		`member ${interfaceName}.${memberName} not found`,
	).toBeDefined();
	return leadingTsDoc(member as ts.Node, source);
}

/**
 * The doc must state the member is host / collaboration-adapter owned AND that
 * the bundled reference adapters (in-memory + localStorage) intentionally do
 * not implement it.
 */
function expectOwnershipLanguage(doc: string, label: string): void {
	expect(doc, `${label}: should mark it optional`).toMatch(/optional/i);
	expect(doc, `${label}: should name host/collaborative ownership`).toMatch(
		/host|collaborat/i,
	);
	expect(
		doc,
		`${label}: should reference the bundled reference adapters`,
	).toMatch(/reference adapter/i);
	expect(doc, `${label}: should name the in-memory reference adapter`).toMatch(
		/in-memory/i,
	);
	expect(
		doc,
		`${label}: should name the localStorage reference adapter`,
	).toMatch(/local[\s-]?storage/i);
	expect(
		doc,
		`${label}: should say the reference adapters do not implement it`,
	).toMatch(/intentionally do not implement|do(es)? not implement/i);
}

describe("collaboration surface is documented as host-owned (finding #4)", () => {
	const source = parseTypes();

	it("SnapshotAdapter.subscribe TSDoc marks it host/collab-owned & unimplemented by reference adapters", () => {
		const doc = memberDoc(source, "SnapshotAdapter", "subscribe");
		expectOwnershipLanguage(doc, "subscribe");
		// Contract details required by the finding: when it fires + unsubscribe.
		expect(doc, "subscribe: documents when onUpdate fires").toMatch(
			/onUpdate.*fires|fires.*onUpdate|remote peer mutates/i,
		);
		expect(doc, "subscribe: documents unsubscribe semantics").toMatch(
			/unsubscribe/i,
		);
		// Pointer to a real implementation.
		expect(doc, "subscribe: points at a collab/Yjs adapter").toMatch(/yjs/i);
	});

	it("SnapshotAdapter.presence TSDoc marks it host/collab-owned & unimplemented by reference adapters", () => {
		const doc = memberDoc(source, "SnapshotAdapter", "presence");
		expectOwnershipLanguage(doc, "presence");
		expect(doc, "presence: points at a collab/Yjs adapter").toMatch(/yjs/i);
	});

	it("SnapshotAdapterPresence interface TSDoc marks it host/collab-owned & unimplemented by reference adapters", () => {
		const declaration = findInterface(source, "SnapshotAdapterPresence");
		expect(declaration, "SnapshotAdapterPresence not found").toBeDefined();
		const doc = leadingTsDoc(declaration as ts.Node, source);
		expectOwnershipLanguage(doc, "SnapshotAdapterPresence");
		expect(
			doc,
			"SnapshotAdapterPresence: points at a collab/Yjs adapter",
		).toMatch(/yjs/i);
	});

	it("README documents subscribe/presence as host-owned, not in the reference adapters", () => {
		const readme = readFileSync(README_PATH, "utf8");
		const heading = "#### Collaboration: `subscribe` & `presence`";
		const start = readme.indexOf(heading);
		expect(
			start,
			"README is missing the host-owned collaboration subsection",
		).toBeGreaterThanOrEqual(0);
		// Section body up to the next markdown heading.
		const rest = readme.slice(start + heading.length);
		const nextHeading = rest.search(/\n#{2,4} /);
		const section = (nextHeading >= 0 ? rest.slice(0, nextHeading) : rest)
			.replace(/\s+/g, " ")
			.trim();

		expect(section).toMatch(/subscribe/i);
		expect(section).toMatch(/presence/i);
		expect(section, "README section: host ownership").toMatch(/host/i);
		expect(section, "README section: names reference adapters").toMatch(
			/reference adapter/i,
		);
		expect(section, "README section: in-memory + localStorage").toMatch(
			/in-memory/i,
		);
		expect(section).toMatch(/local[\s-]?storage/i);
		expect(
			section,
			"README section: reference adapters do not implement them",
		).toMatch(/intentionally do not implement|do(es)? not implement/i);
		expect(section, "README section: points at the Yjs/collab adapter").toMatch(
			/yjs|collab/i,
		);
	});
});
