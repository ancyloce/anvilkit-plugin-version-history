import { describe, expect, it } from "vitest";

import { LruCache } from "../utils/lru.js";

describe("LruCache", () => {
	it("rejects a non-positive capacity", () => {
		expect(() => new LruCache<string, number>(0)).toThrow(RangeError);
		expect(() => new LruCache<string, number>(-1)).toThrow(RangeError);
		expect(() => new LruCache<string, number>(1.5)).toThrow(RangeError);
	});

	it("stores and retrieves values up to capacity", () => {
		const cache = new LruCache<string, number>(3);
		cache.set("a", 1);
		cache.set("b", 2);
		cache.set("c", 3);
		expect(cache.size).toBe(3);
		expect(cache.get("a")).toBe(1);
		expect(cache.get("b")).toBe(2);
		expect(cache.get("c")).toBe(3);
		expect(cache.has("a")).toBe(true);
	});

	it("stays bounded and evicts the least-recently-used entry on overflow", () => {
		const cache = new LruCache<string, number>(2);
		cache.set("a", 1);
		cache.set("b", 2);
		cache.set("c", 3); // evicts "a"

		expect(cache.size).toBe(2);
		expect(cache.has("a")).toBe(false);
		expect(cache.get("b")).toBe(2);
		expect(cache.get("c")).toBe(3);
	});

	it("promotes on get so the oldest-untouched key is evicted", () => {
		const cache = new LruCache<string, number>(2);
		cache.set("a", 1);
		cache.set("b", 2);
		// Touch "a" → "b" becomes least-recently-used.
		expect(cache.get("a")).toBe(1);
		cache.set("c", 3); // evicts "b", not "a"

		expect(cache.has("a")).toBe(true);
		expect(cache.has("b")).toBe(false);
		expect(cache.has("c")).toBe(true);
	});

	it("stays bounded across many distinct inserts (the panel-cache invariant)", () => {
		const cache = new LruCache<string, number>(50);
		for (let i = 0; i < 1000; i += 1) {
			cache.set(`id-${i}`, i);
			expect(cache.size).toBeLessThanOrEqual(50);
		}
		expect(cache.size).toBe(50);
		// Only the most recent 50 ids remain.
		expect(cache.has("id-999")).toBe(true);
		expect(cache.has("id-949")).toBe(false);
	});

	it("treats a re-set key as recently used without growing", () => {
		const cache = new LruCache<string, number>(2);
		cache.set("a", 1);
		cache.set("b", 2);
		cache.set("a", 10); // update, not a new slot
		expect(cache.size).toBe(2);
		expect(cache.get("a")).toBe(10);
		cache.set("c", 3); // evicts "b" (a was just touched)
		expect(cache.has("b")).toBe(false);
		expect(cache.has("a")).toBe(true);
	});

	it("clear() empties the cache", () => {
		const cache = new LruCache<string, number>(2);
		cache.set("a", 1);
		cache.clear();
		expect(cache.size).toBe(0);
		expect(cache.get("a")).toBeUndefined();
	});
});
