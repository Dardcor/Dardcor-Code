/**
 * Dardcor Code - String Trie Data Structure
 */

class TrieNode<V> {
	children = new Map<string, TrieNode<V>>();
	value: V | undefined = undefined;
}

export class StringTrie<V> {
	private readonly _root = new TrieNode<V>();

	public insert(key: string, value: V): void {
		let current = this._root;
		for (const char of key) {
			let child = current.children.get(char);
			if (!child) {
				child = new TrieNode<V>();
				current.children.set(char, child);
			}
			current = child;
		}
		current.value = value;
	}

	public find(key: string): V | undefined {
		let current = this._root;
		for (const char of key) {
			const child = current.children.get(char);
			if (!child) {
				return undefined;
			}
			current = child;
		}
		return current.value;
	}

	public hasPrefix(prefix: string): boolean {
		let current = this._root;
		for (const char of prefix) {
			const child = current.children.get(char);
			if (!child) {
				return false;
			}
			current = child;
		}
		return true;
	}
}
