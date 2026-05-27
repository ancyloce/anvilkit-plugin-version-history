/**
 * Minimal insertion-ordered LRU map.
 *
 * `Map` preserves insertion order, so the least-recently-used live key is
 * always `keys().next().value`. `get`/`set` re-insert the touched key so it
 * becomes most-recently-used; once `capacity` is exceeded `set` evicts the
 * oldest. Exposes the subset of the `Map` surface the version-history panel
 * uses (`get`/`set`/`clear`/`has`/`size`) so it is a drop-in replacement.
 *
 * The panel previously held an unbounded `Map<string, PageIR>` of every
 * snapshot ever opened for the panel's lifetime; this caps that retention.
 */
export class LruCache<K, V> {
	private readonly map = new Map<K, V>();

	constructor(private readonly capacity: number) {
		if (!Number.isInteger(capacity) || capacity < 1) {
			throw new RangeError(
				`LruCache capacity must be a positive integer, got ${capacity}`,
			);
		}
	}

	get size(): number {
		return this.map.size;
	}

	has(key: K): boolean {
		return this.map.has(key);
	}

	get(key: K): V | undefined {
		if (!this.map.has(key)) {
			return undefined;
		}
		const value = this.map.get(key) as V;
		// Promote to most-recently-used.
		this.map.delete(key);
		this.map.set(key, value);
		return value;
	}

	set(key: K, value: V): void {
		// Re-insert so an existing key moves to most-recently-used.
		this.map.delete(key);
		this.map.set(key, value);
		while (this.map.size > this.capacity) {
			const oldest = this.map.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			this.map.delete(oldest);
		}
	}

	clear(): void {
		this.map.clear();
	}
}
