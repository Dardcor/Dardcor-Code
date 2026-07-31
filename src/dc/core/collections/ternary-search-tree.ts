/**
 * Dardcor Code - Ternary Search Tree for Fast Prefix & Path Match
 */

class TstNode<K, V> {
	key!: K;
	value: V | undefined;
	left: TstNode<K, V> | undefined;
	mid: TstNode<K, V> | undefined;
	right: TstNode<K, V> | undefined;
}

export class TernarySearchTree<K extends string, V> {
	private _root: TstNode<string, V> | undefined;

	public set(key: K, value: V): void {
		if (!key) return;
		this._root = this._insert(this._root, key, value, 0);
	}

	private _insert(node: TstNode<string, V> | undefined, key: string, value: V, index: number): TstNode<string, V> {
		const char = key[index];
		if (!node) {
			node = new TstNode<string, V>();
			node.key = char;
		}

		if (char < node.key) {
			node.left = this._insert(node.left, key, value, index);
		} else if (char > node.key) {
			node.right = this._insert(node.right, key, value, index);
		} else if (index < key.length - 1) {
			node.mid = this._insert(node.mid, key, value, index + 1);
		} else {
			node.value = value;
		}

		return node;
	}

	public get(key: K): V | undefined {
		if (!key) return undefined;
		const node = this._search(this._root, key, 0);
		return node ? node.value : undefined;
	}

	private _search(node: TstNode<string, V> | undefined, key: string, index: number): TstNode<string, V> | undefined {
		if (!node) return undefined;
		const char = key[index];
		if (char < node.key) {
			return this._search(node.left, key, index);
		} else if (char > node.key) {
			return this._search(node.right, key, index);
		} else if (index < key.length - 1) {
			return this._search(node.mid, key, index + 1);
		} else {
			return node;
		}
	}
}
