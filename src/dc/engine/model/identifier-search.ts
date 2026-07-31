const IDENTIFIER_REGEX = /\b[A-Za-z_$][A-Za-z0-9_$]*\b/g;

interface ITrieNode {
	children: Map<string, ITrieNode>;
	lines: Set<number>;
}

function createNode(): ITrieNode {
	return { children: new Map<string, ITrieNode>(), lines: new Set<number>() };
}

export class IdentifierSearch {
	private readonly _root: ITrieNode = createNode();
	private _totalWordCount = 0;

	public insert(lineNumber: number, text: string): void {
		IDENTIFIER_REGEX.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = IDENTIFIER_REGEX.exec(text)) !== null) {
			this._insertWord(match[0].toLowerCase(), lineNumber);
		}
	}

	public search(prefix: string): Set<number> {
		const result = new Set<number>();
		const lower = prefix.toLowerCase();
		if (lower.length === 0) {
			return result;
		}
		let node = this._root;
		for (let i = 0; i < lower.length; i++) {
			const child = node.children.get(lower.charAt(i));
			if (!child) {
				return result;
			}
			node = child;
		}
		this._collectLines(node, result);
		return result;
	}

	public hasWord(word: string): boolean {
		const lower = word.toLowerCase();
		let node = this._root;
		for (let i = 0; i < lower.length; i++) {
			const child = node.children.get(lower.charAt(i));
			if (!child) {
				return false;
			}
			node = child;
		}
		return node.lines.size > 0;
	}

	public getLineCountForWord(word: string): number {
		const lower = word.toLowerCase();
		let node = this._root;
		for (let i = 0; i < lower.length; i++) {
			const child = node.children.get(lower.charAt(i));
			if (!child) {
				return 0;
			}
			node = child;
		}
		return node.lines.size;
	}

	public getWordsStartingWith(prefix: string, limit: number = 100): string[] {
		const result: string[] = [];
		const lower = prefix.toLowerCase();
		if (lower.length === 0) {
			return result;
		}
		let node = this._root;
		for (let i = 0; i < lower.length; i++) {
			const child = node.children.get(lower.charAt(i));
			if (!child) {
				return result;
			}
			node = child;
		}
		const walk = (current: ITrieNode, currentWord: string): void => {
			if (result.length >= limit) {
				return;
			}
			if (current.lines.size > 0) {
				result.push(currentWord);
			}
			for (const [ch, child] of current.children) {
				walk(child, currentWord + ch);
				if (result.length >= limit) {
					return;
				}
			}
		};
		walk(node, lower);
		return result;
	}

	public getTotalWordCount(): number {
		return this._totalWordCount;
	}

	public clear(): void {
		this._root.children.clear();
		this._root.lines.clear();
		this._totalWordCount = 0;
	}

	private _insertWord(word: string, lineNumber: number): void {
		let node = this._root;
		for (let i = 0; i < word.length; i++) {
			const ch = word.charAt(i);
			let child = node.children.get(ch);
			if (!child) {
				child = createNode();
				node.children.set(ch, child);
			}
			node = child;
		}
		node.lines.add(lineNumber);
		this._totalWordCount++;
	}

	private _collectLines(node: ITrieNode, out: Set<number>): void {
		if (node.lines.size > 0) {
			for (const line of node.lines) {
				out.add(line);
			}
		}
		for (const child of node.children.values()) {
			this._collectLines(child, out);
		}
	}
}
