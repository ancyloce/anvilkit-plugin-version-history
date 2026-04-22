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

		expect(globalThis.localStorage.getItem("test:snapshots:index")).toContain(id);
		expect(globalThis.localStorage.getItem(`test:snapshots:${id}`)).not.toBeNull();

		const loaded = await Promise.resolve(adapter.load(id));
		expect(loaded).toEqual(ir);
	});
});
