import type { PageIR, PageIRNode } from "@anvilkit/core/types";

/**
 * Note: `move-node` is a hint, not a mutation. `applyDiff` validates it but
 * does not perform any reparenting — the authoritative reparenting/reorder
 * signal is `change-children` on the affected parent(s). Consumers that
 * inspect an `IRDiff` for display or logging may use `move-node` for
 * presentation, but should not rely on it for replay correctness.
 */
export type IRDiffOp =
	| { kind: "add-node"; path: string; node: PageIRNode }
	| { kind: "remove-node"; path: string; nodeId: string }
	| { kind: "move-node"; from: string; to: string; nodeId: string }
	| {
			kind: "change-prop";
			path: string;
			key: string;
			before: unknown;
			after: unknown;
	  }
	| {
			kind: "change-children";
			path: string;
			before: readonly string[];
			after: readonly string[];
	  }
	| {
			kind: "meta-changed";
			path: string;
			key: "locked" | "owner" | "version" | "notes";
			before: unknown;
			after: unknown;
	  };

export type IRDiff = readonly IRDiffOp[];

export interface IRDiffSummary {
	readonly added: number;
	readonly removed: number;
	readonly moved: number;
	readonly changed: number;
	/**
	 * Count of `meta-changed` ops in the diff. Optional so older
	 * consumers that destructure `summarizeDiff` without `metaChanged`
	 * stay backward-compatible — additive only.
	 */
	readonly metaChanged?: number;
	readonly description: string;
}

const META_KEYS = ["locked", "owner", "version", "notes"] as const;
type MetaKey = (typeof META_KEYS)[number];

interface IndexedNode {
	readonly path: string;
	readonly node: PageIRNode;
	readonly parentId?: string;
}

interface MutablePageIR {
	version: "1";
	root: MutablePageIRNode;
	assets: unknown[];
	metadata: Record<string, unknown>;
}

interface MutablePageIRNode {
	id: string;
	type: string;
	props: Record<string, unknown>;
	children?: MutablePageIRNode[];
	assets?: unknown[];
	meta?: Record<string, unknown>;
}

export class DiffApplyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DiffApplyError";
	}
}

export function diffIR(a: PageIR, b: PageIR): IRDiff {
	const aIndex = indexTree(a);
	const bIndex = indexTree(b);
	const removes: Array<Extract<IRDiffOp, { kind: "remove-node" }>> = [];
	const adds: Array<Extract<IRDiffOp, { kind: "add-node" }>> = [];
	const moves: Array<Extract<IRDiffOp, { kind: "move-node" }>> = [];
	const childChanges: Array<Extract<IRDiffOp, { kind: "change-children" }>> = [];
	const propChanges: Array<Extract<IRDiffOp, { kind: "change-prop" }>> = [];
	const metaChanges: Array<Extract<IRDiffOp, { kind: "meta-changed" }>> = [];

	for (const nodeId of sortedIds(bIndex)) {
		if (!aIndex.has(nodeId)) {
			const entry = bIndex.get(nodeId);
			if (entry) {
				adds.push({
					kind: "add-node",
					path: entry.path,
					node: entry.node,
				});
			}
		}
	}

	for (const nodeId of sortedIds(aIndex)) {
		if (!bIndex.has(nodeId)) {
			const entry = aIndex.get(nodeId);
			if (entry) {
				removes.push({
					kind: "remove-node",
					path: entry.path,
					nodeId,
				});
			}
		}
	}

	for (const nodeId of sortedIds(aIndex)) {
		const before = aIndex.get(nodeId);
		const after = bIndex.get(nodeId);
		if (!before || !after) {
			continue;
		}

		if (hasNodePositionChange(before, after)) {
			moves.push({
				kind: "move-node",
				from: before.path,
				to: after.path,
				nodeId,
			});
		}

		const beforeChildren = childIds(before.node);
		const afterChildren = childIds(after.node);
		if (!deepEqual(beforeChildren, afterChildren)) {
			childChanges.push({
				kind: "change-children",
				path: `${before.path}/children`,
				before: beforeChildren,
				after: afterChildren,
			});
		}

		const beforeProps = before.node.props ?? {};
		const afterProps = after.node.props ?? {};
		const propKeys = new Set([
			...Object.keys(beforeProps),
			...Object.keys(afterProps),
		]);

		for (const key of Array.from(propKeys).sort((left, right) =>
			left.localeCompare(right),
		)) {
			const previous = beforeProps[key];
			const next = afterProps[key];
			if (!deepEqual(previous, next)) {
				propChanges.push({
					kind: "change-prop",
					path: `${before.path}/props`,
					key,
					before: previous,
					after: next,
				});
			}
		}

		const beforeMeta = (before.node.meta ?? {}) as Record<MetaKey, unknown>;
		const afterMeta = (after.node.meta ?? {}) as Record<MetaKey, unknown>;
		for (const metaKey of META_KEYS) {
			const previous = beforeMeta[metaKey];
			const next = afterMeta[metaKey];
			if (!deepEqual(previous, next)) {
				metaChanges.push({
					kind: "meta-changed",
					path: `${before.path}/meta`,
					key: metaKey,
					before: previous,
					after: next,
				});
			}
		}
	}

	return Object.freeze([
		...removes.sort((left, right) => comparePathDesc(left.path, right.path)),
		...adds.sort((left, right) => comparePathAsc(left.path, right.path)),
		...moves.sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
		...childChanges.sort((left, right) =>
			comparePathAsc(left.path, right.path),
		),
		...propChanges.sort((left, right) => {
			const pathOrder = comparePathAsc(left.path, right.path);
			if (pathOrder !== 0) {
				return pathOrder;
			}

			return left.key.localeCompare(right.key);
		}),
		...metaChanges.sort((left, right) => {
			const pathOrder = comparePathAsc(left.path, right.path);
			if (pathOrder !== 0) {
				return pathOrder;
			}

			return left.key.localeCompare(right.key);
		}),
	]);
}

export function applyDiff(a: PageIR, diff: IRDiff): PageIR {
	const originalPathNodeIds = buildOriginalPathNodeIds(a);
	const nodeContent = new Map<string, NodeContent>();
	const childrenMap = new Map<string, string[]>();
	const originalIds = new Set<string>();

	collectOriginalIds(a.root, originalIds);
	collectContent(a.root, nodeContent, childrenMap);

	const removed = new Set<string>();
	const knownIds = new Set<string>(originalIds);

	for (const op of diff) {
		switch (op.kind) {
			case "add-node": {
				if (op.path === "/root") {
					throw new DiffApplyError("Cannot add a second root node");
				}
				assertValidChildIndexPath(op.path);
				if (originalIds.has(op.node.id)) {
					throw new DiffApplyError(
						`Cannot add duplicate node id ${op.node.id} at ${op.path}`,
					);
				}

				collectAddedContent(op.node, nodeContent, childrenMap, originalIds, knownIds);
				break;
			}
			case "remove-node": {
				if (op.path === "/root") {
					throw new DiffApplyError("Cannot remove the root node");
				}
				assertValidChildIndexPath(op.path);
				const expectedNodeId = originalPathNodeIds.get(op.path);
				if (expectedNodeId === undefined) {
					throw new DiffApplyError(`Node not found at ${op.path}`);
				}
				if (expectedNodeId !== op.nodeId) {
					throw new DiffApplyError(
						`Node id mismatch while removing ${op.path}: expected ${op.nodeId}, got ${expectedNodeId}`,
					);
				}
				removed.add(op.nodeId);
				break;
			}
			case "change-prop": {
				const nodeId = resolveNodeIdForChange(op.path, "/props", originalPathNodeIds);
				const content = nodeContent.get(nodeId);
				if (!content) {
					throw new DiffApplyError(
						`Cannot change prop on missing node ${nodeId} (${op.path})`,
					);
				}

				const currentValue = content.props[op.key];
				if (!deepEqual(currentValue, op.before)) {
					throw new DiffApplyError(
						`Prop mismatch at ${op.path}/${op.key}: expected ${JSON.stringify(op.before)}, got ${JSON.stringify(currentValue)}`,
					);
				}

				if (op.after === undefined) {
					const nextProps = { ...content.props };
					delete nextProps[op.key];
					content.props = nextProps;
				} else {
					content.props = { ...content.props, [op.key]: structuredClone(op.after) };
				}
				break;
			}
			case "change-children": {
				const parentId = resolveNodeIdForChange(op.path, "/children", originalPathNodeIds);
				if (!nodeContent.has(parentId)) {
					throw new DiffApplyError(
						`Cannot reorder children of missing node ${parentId} (${op.path})`,
					);
				}
				const seen = new Set<string>();
				for (const childId of op.after) {
					if (seen.has(childId)) {
						throw new DiffApplyError(
							`Duplicate child ${childId} while applying ${op.path}`,
						);
					}
					seen.add(childId);
				}
				childrenMap.set(parentId, [...op.after]);
				break;
			}
			case "move-node": {
				if (op.from === "/root" || op.to === "/root") {
					throw new DiffApplyError("Cannot move the root node");
				}
				assertValidChildIndexPath(op.from);
				assertValidChildIndexPath(op.to);
				if (!originalIds.has(op.nodeId)) {
					throw new DiffApplyError(`Node ${op.nodeId} not found for move`);
				}
				break;
			}
			case "meta-changed": {
				const nodeId = resolveNodeIdForChange(op.path, "/meta", originalPathNodeIds);
				const content = nodeContent.get(nodeId);
				if (!content) {
					throw new DiffApplyError(
						`Cannot change meta on missing node ${nodeId} (${op.path})`,
					);
				}

				const currentMeta = content.meta ?? {};
				const currentValue = currentMeta[op.key];
				if (!deepEqual(currentValue, op.before)) {
					throw new DiffApplyError(
						`Meta mismatch at ${op.path}/${op.key}: expected ${JSON.stringify(op.before)}, got ${JSON.stringify(currentValue)}`,
					);
				}

				if (op.after === undefined) {
					const nextMeta = { ...currentMeta };
					delete nextMeta[op.key];
					if (Object.keys(nextMeta).length === 0) {
						content.meta = undefined;
					} else {
						content.meta = nextMeta;
					}
				} else {
					content.meta = {
						...currentMeta,
						[op.key]: structuredClone(op.after),
					};
				}
				break;
			}
			/* c8 ignore next 2 */
			default:
				assertNever(op);
		}
	}

	for (const id of removed) {
		nodeContent.delete(id);
		childrenMap.delete(id);
	}

	for (const [parentId, ids] of childrenMap) {
		const filtered = ids.filter((id) => !removed.has(id));
		if (filtered.length === ids.length) {
			continue;
		}
		childrenMap.set(parentId, filtered);
	}

	const rootId = a.root.id;
	const visiting = new Set<string>();
	const built = buildReconstructedNode(rootId, nodeContent, childrenMap, visiting);

	const draft: MutablePageIR = {
		version: "1",
		root: built,
		assets: structuredClone(a.assets) as unknown[],
		metadata: structuredClone(a.metadata) as Record<string, unknown>,
	};

	return deepFreeze(draft) as PageIR;
}

interface NodeContent {
	id: string;
	type: string;
	props: Record<string, unknown>;
	assets?: unknown[];
	meta?: Record<string, unknown>;
}

function collectContent(
	node: PageIRNode,
	nodeContent: Map<string, NodeContent>,
	childrenMap: Map<string, string[]>,
): void {
	const content: NodeContent = {
		id: node.id,
		type: node.type,
		props: structuredClone(node.props) as Record<string, unknown>,
	};
	if (node.assets !== undefined) {
		content.assets = structuredClone(node.assets) as unknown[];
	}
	if (node.meta !== undefined) {
		content.meta = structuredClone(node.meta) as Record<string, unknown>;
	}
	nodeContent.set(node.id, content);

	const children = node.children ?? [];
	if (children.length > 0) {
		childrenMap.set(node.id, children.map((child) => child.id));
		for (const child of children) {
			collectContent(child, nodeContent, childrenMap);
		}
	} else {
		childrenMap.delete(node.id);
	}
}

function collectOriginalIds(node: PageIRNode, ids: Set<string>): void {
	ids.add(node.id);
	for (const child of node.children ?? []) {
		collectOriginalIds(child, ids);
	}
}

function collectAddedContent(
	node: PageIRNode,
	nodeContent: Map<string, NodeContent>,
	childrenMap: Map<string, string[]>,
	originalIds: ReadonlySet<string>,
	knownIds: Set<string>,
): void {
	if (originalIds.has(node.id)) {
		return;
	}

	const content: NodeContent = {
		id: node.id,
		type: node.type,
		props: structuredClone(node.props) as Record<string, unknown>,
	};
	if (node.assets !== undefined) {
		content.assets = structuredClone(node.assets) as unknown[];
	}
	if (node.meta !== undefined) {
		content.meta = structuredClone(node.meta) as Record<string, unknown>;
	}
	nodeContent.set(node.id, content);
	knownIds.add(node.id);

	const children = node.children ?? [];
	if (children.length > 0) {
		childrenMap.set(node.id, children.map((child) => child.id));
		for (const child of children) {
			collectAddedContent(child, nodeContent, childrenMap, originalIds, knownIds);
		}
	}
}

function assertValidChildIndexPath(path: string): void {
	if (!path.startsWith("/")) {
		throw new DiffApplyError(`Invalid JSON pointer path: ${path}`);
	}
	const segments = path.split("/").slice(1);
	if (segments[0] !== "root") {
		throw new DiffApplyError(`Unsupported node path: ${path}`);
	}
	if (segments.length < 3 || (segments.length - 1) % 2 !== 0) {
		throw new DiffApplyError(`Unsupported node path: ${path}`);
	}
	for (let index = 1; index < segments.length; index += 2) {
		if (segments[index] !== "children") {
			throw new DiffApplyError(
				`Unsupported node path segment "${segments[index]}" in ${path}`,
			);
		}
		const indexSegment = segments[index + 1];
		if (indexSegment === undefined) {
			throw new DiffApplyError(`Missing child index in ${path}`);
		}
		const childIndex = Number(indexSegment);
		if (!Number.isInteger(childIndex) || childIndex < 0) {
			throw new DiffApplyError(`Invalid child index "${indexSegment}" in ${path}`);
		}
	}
}

function resolveNodeIdForChange(
	path: string,
	suffix: string,
	originalPathNodeIds: ReadonlyMap<string, string>,
): string {
	const nodePath = trimSuffix(path, suffix);
	const nodeId = originalPathNodeIds.get(nodePath);
	if (nodeId === undefined) {
		throw new DiffApplyError(`Unknown node path ${nodePath} in ${path}`);
	}

	return nodeId;
}

function buildReconstructedNode(
	id: string,
	nodeContent: ReadonlyMap<string, NodeContent>,
	childrenMap: ReadonlyMap<string, string[]>,
	visiting: Set<string>,
): MutablePageIRNode {
	if (visiting.has(id)) {
		throw new DiffApplyError(`Cycle detected while reconstructing tree at ${id}`);
	}
	visiting.add(id);

	const content = nodeContent.get(id);
	if (!content) {
		throw new DiffApplyError(`Missing node content for ${id}`);
	}

	const node: MutablePageIRNode = {
		id: content.id,
		type: content.type,
		props: structuredClone(content.props) as Record<string, unknown>,
	};
	if (content.assets !== undefined) {
		node.assets = structuredClone(content.assets) as unknown[];
	}
	if (content.meta !== undefined) {
		node.meta = structuredClone(content.meta) as Record<string, unknown>;
	}

	const childIds = childrenMap.get(id);
	if (childIds && childIds.length > 0) {
		node.children = childIds.map((childId) =>
			buildReconstructedNode(childId, nodeContent, childrenMap, visiting),
		);
	}

	visiting.delete(id);
	return node;
}

export function summarizeDiff(diff: IRDiff): IRDiffSummary {
	let added = 0;
	let removed = 0;
	let moved = 0;
	let changed = 0;
	let metaChanged = 0;
	for (const op of diff) {
		switch (op.kind) {
			case "add-node":
				added += 1;
				break;
			case "remove-node":
				removed += 1;
				break;
			case "move-node":
				moved += 1;
				break;
			case "change-prop":
			case "change-children":
				changed += 1;
				break;
			case "meta-changed":
				metaChanged += 1;
				break;
		}
	}
	const total = added + removed + moved + changed + metaChanged;

	if (total === 0) {
		return {
			added,
			removed,
			moved,
			changed,
			description: "No changes",
		};
	}

	const parts: string[] = [];
	if (added > 0) {
		parts.push(`${added} added`);
	}
	if (removed > 0) {
		parts.push(`${removed} removed`);
	}
	if (moved > 0) {
		parts.push(`${moved} moved`);
	}
	if (changed > 0) {
		parts.push(`${changed} changed`);
	}
	if (metaChanged > 0) {
		parts.push(`${metaChanged} meta`);
	}

	const summary: IRDiffSummary = {
		added,
		removed,
		moved,
		changed,
		description: `${total} change${total === 1 ? "" : "s"}: ${parts.join(", ")}`,
	};
	// Include `metaChanged` only when non-zero so legacy snapshot
	// matchers (`toEqual({...})`) without `metaChanged` keep passing —
	// the field is optional on `IRDiffSummary` for exactly this reason.
	if (metaChanged > 0) {
		(summary as { metaChanged?: number }).metaChanged = metaChanged;
	}
	return summary;
}

function indexTree(ir: PageIR): Map<string, IndexedNode> {
	const index = new Map<string, IndexedNode>();

	const visit = (node: PageIRNode, path: string, parentId?: string): void => {
		index.set(node.id, { path, node, parentId });
		node.children?.forEach((child, childIndex) => {
			visit(child, `${path}/children/${childIndex}`, node.id);
		});
	};

	visit(ir.root, "/root");
	return index;
}

function childIds(node: PageIRNode): readonly string[] {
	return Object.freeze(node.children?.map((child) => child.id) ?? []);
}

function buildOriginalPathNodeIds(a: PageIR): ReadonlyMap<string, string> {
	const pathNodeIds = new Map<string, string>();

	for (const [nodeId, entry] of indexTree(a)) {
		pathNodeIds.set(entry.path, nodeId);
	}

	return pathNodeIds;
}

function deepFreeze<T>(value: T): T {
	if (Array.isArray(value)) {
		value.forEach((entry) => deepFreeze(entry));
		return Object.freeze(value);
	}

	if (value !== null && typeof value === "object") {
		for (const entry of Object.values(value as Record<string, unknown>)) {
			deepFreeze(entry);
		}
		return Object.freeze(value);
	}

	return value;
}

function deepEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) {
		return true;
	}

	if (typeof left !== typeof right) {
		return false;
	}

	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
			return false;
		}

		for (let index = 0; index < left.length; index += 1) {
			if (!deepEqual(left[index], right[index])) {
				return false;
			}
		}

		return true;
	}

	if (
		left === null ||
		right === null ||
		typeof left !== "object" ||
		typeof right !== "object"
	) {
		return false;
	}

	const leftRecord = left as Record<string, unknown>;
	const rightRecord = right as Record<string, unknown>;
	const leftKeys = Object.keys(leftRecord).sort((a, b) => a.localeCompare(b));
	const rightKeys = Object.keys(rightRecord).sort((a, b) => a.localeCompare(b));

	if (leftKeys.length !== rightKeys.length) {
		return false;
	}

	for (let index = 0; index < leftKeys.length; index += 1) {
		if (leftKeys[index] !== rightKeys[index]) {
			return false;
		}

		const key = leftKeys[index]!;
		if (!deepEqual(leftRecord[key], rightRecord[key])) {
			return false;
		}
	}

	return true;
}

function tokenizePath(path: string): string[] {
	if (!path.startsWith("/")) {
		throw new DiffApplyError(`Invalid JSON pointer path: ${path}`);
	}

	return path.split("/").slice(1);
}

function trimSuffix(value: string, suffix: string): string {
	if (!value.endsWith(suffix)) {
		throw new DiffApplyError(`Path ${value} does not end with ${suffix}`);
	}

	return value.slice(0, -suffix.length);
}

function sortedIds(index: Map<string, IndexedNode>): string[] {
	return Array.from(index.keys()).sort((left, right) => left.localeCompare(right));
}

function hasNodePositionChange(before: IndexedNode, after: IndexedNode): boolean {
	return before.path !== after.path || before.parentId !== after.parentId;
}

function comparePathAsc(left: string, right: string): number {
	const leftSegments = tokenizePath(left);
	const rightSegments = tokenizePath(right);
	const maxLength = Math.max(leftSegments.length, rightSegments.length);

	for (let index = 0; index < maxLength; index += 1) {
		const leftSegment = leftSegments[index];
		const rightSegment = rightSegments[index];
		if (leftSegment === undefined) {
			return -1;
		}
		if (rightSegment === undefined) {
			return 1;
		}
		if (leftSegment === rightSegment) {
			continue;
		}

		const leftNumber = Number(leftSegment);
		const rightNumber = Number(rightSegment);
		const bothNumeric = Number.isInteger(leftNumber) && Number.isInteger(rightNumber);
		if (bothNumeric) {
			return leftNumber - rightNumber;
		}

		return leftSegment.localeCompare(rightSegment);
	}

	return 0;
}

function comparePathDesc(left: string, right: string): number {
	return comparePathAsc(right, left);
}

function assertNever(value: never): never {
	throw new Error(`Unhandled op: ${JSON.stringify(value)}`);
}
