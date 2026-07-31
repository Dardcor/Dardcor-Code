/**
 * Dardcor Code - DAG Dependency Graph & Cycle Detector (Task 184)
 * Mirrors: vs/platform/instantiation/common/graph.ts
 */

export class Graph<T> {
	private readonly _nodes = new Map<string, { data: T; incoming: Set<string>; outgoing: Set<string> }>();

	constructor(private readonly _hashFn: (element: T) => string) {}

	lookupOrInsertNode(data: T): void {
		const key = this._hashFn(data);
		if (!this._nodes.has(key)) {
			this._nodes.set(key, { data, incoming: new Set(), outgoing: new Set() });
		}
	}

	insertEdge(from: T, to: T): void {
		const fromKey = this._hashFn(from);
		const toKey = this._hashFn(to);
		this.lookupOrInsertNode(from);
		this.lookupOrInsertNode(to);
		this._nodes.get(fromKey)!.outgoing.add(toKey);
		this._nodes.get(toKey)!.incoming.add(fromKey);
	}

	removeNode(data: T): void {
		const key = this._hashFn(data);
		const node = this._nodes.get(key);
		if (!node) return;
		for (const out of node.outgoing) {
			this._nodes.get(out)?.incoming.delete(key);
		}
		for (const inc of node.incoming) {
			this._nodes.get(inc)?.outgoing.delete(key);
		}
		this._nodes.delete(key);
	}

	hasCycle(): boolean {
		const visited = new Set<string>();
		const stack = new Set<string>();

		const dfs = (key: string): boolean => {
			visited.add(key);
			stack.add(key);
			const node = this._nodes.get(key);
			if (node) {
				for (const next of node.outgoing) {
					if (!visited.has(next)) {
						if (dfs(next)) return true;
					} else if (stack.has(next)) {
						return true;
					}
				}
			}
			stack.delete(key);
			return false;
		};

		for (const key of this._nodes.keys()) {
			if (!visited.has(key)) {
				if (dfs(key)) return true;
			}
		}
		return false;
	}

	roots(): T[] {
		const result: T[] = [];
		for (const node of this._nodes.values()) {
			if (node.incoming.size === 0) {
				result.push(node.data);
			}
		}
		return result;
	}
}
