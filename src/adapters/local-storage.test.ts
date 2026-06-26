import { createFakePageIR } from "@anvilkit/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAdapterContract } from "../testing/run-adapter-contract.js";

import { localStorageAdapter } from "./local-storage.js";

class MemoryStorage implements Storage {
	#items = new Map<string, string>();

	get length(): number {
		return this.#items.size;
	}

	clear(): void {
		this.#items.clear();
	}

	getItem(key: string): string | null {
		return this.#items.get(key) ?? null;
	}

	key(index: number): string | null {
		return [...this.#items.keys()][index] ?? null;
	}

	removeItem(key: string): void {
		this.#items.delete(key);
	}

	setItem(key: string, value: string): void {
		this.#items.set(key, value);
	}
}

beforeEach(() => {
	vi.stubGlobal("localStorage", new MemoryStorage());
});

afterEach(() => {
	vi.unstubAllGlobals();
});

runAdapterContract(() => localStorageAdapter({ namespace: "test" }), {
	describe,
	expect,
	it,
});

describe("localStorageAdapter", () => {
	it("round-trips through globalThis.localStorage", async () => {
		const adapter = localStorageAdapter({ namespace: "test" });
		const ir = createFakePageIR();

		const id = await Promise.resolve(adapter.save(ir, {}));

		expect(globalThis.localStorage.getItem("test:snapshots:index")).toContain(
			id,
		);
		expect(
			globalThis.localStorage.getItem(`test:snapshots:${id}`),
		).not.toBeNull();

		const loaded = await Promise.resolve(adapter.load(id));
		expect(loaded).toEqual(ir);
	});
});

describe("localStorageAdapter namespace validation", () => {
	it("throws for an empty namespace", () => {
		expect(() => localStorageAdapter({ namespace: "" })).toThrow(TypeError);
	});

	it("throws for a whitespace-only namespace", () => {
		expect(() => localStorageAdapter({ namespace: "   " })).toThrow(TypeError);
		expect(() => localStorageAdapter({ namespace: "\t\n" })).toThrow(TypeError);
	});

	it("rejects a non-string namespace passed from untyped JS", () => {
		expect(() =>
			// biome-ignore lint/suspicious/noExplicitAny: simulate an untyped JS caller
			localStorageAdapter({ namespace: undefined as any }),
		).toThrow(TypeError);
	});

	it("accepts a valid namespace and derives keys verbatim (no trimming)", async () => {
		const adapter = localStorageAdapter({ namespace: "fixed" });
		const ir = createFakePageIR();

		const id = await Promise.resolve(adapter.save(ir, {}));

		// Key derivation for valid namespaces must stay byte-for-byte identical.
		expect(globalThis.localStorage.getItem("fixed:snapshots:index")).toContain(
			id,
		);
		expect(
			globalThis.localStorage.getItem(`fixed:snapshots:${id}`),
		).not.toBeNull();
		expect(await Promise.resolve(adapter.list())).toHaveLength(1);
	});

	it("treats a non-empty-after-trim namespace as valid and keeps surrounding whitespace in keys", async () => {
		const adapter = localStorageAdapter({ namespace: " spaced " });
		const ir = createFakePageIR();

		const id = await Promise.resolve(adapter.save(ir, {}));

		expect(
			globalThis.localStorage.getItem(" spaced :snapshots:index"),
		).toContain(id);
	});
});
