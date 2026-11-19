/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const enum TestIdPathParts {
	Delimiter = '\0',
}

export const enum TestPosition {
	IsSame,
	Disconnected,
	IsChild,
	IsParent,
}

type TestItemLike = { id: string; parent?: TestItemLike; _isRoot?: boolean };

export class TestId {
	private stringifed?: string;

	public static fromExtHostTestItem(item: TestItemLike, rootId: string, parent = item.parent) {
		if (item._isRoot) {
			return new TestId([rootId]);
		}

		const path = [item.id];
		for (let i = parent; i && i.id !== rootId; i = i.parent) {
			path.push(i.id);
		}
		path.push(rootId);

		return new TestId(path.reverse());
	}

	public static isRoot(idString: string) {
		return !idString.includes(TestIdPathParts.Delimiter);
	}

	public static root(idString: string) {
		const idx = idString.indexOf(TestIdPathParts.Delimiter);
		return idx === -1 ? idString : idString.slice(0, idx);
	}

	public static fromString(idString: string) {
		return new TestId(idString.split(TestIdPathParts.Delimiter));
	}

	public static join(base: TestId, b: string) {
		return new TestId([...base.path, b]);
	}

	public static split(idString: string) {
		return idString.split(TestIdPathParts.Delimiter);
	}

	public static joinToString(base: string | TestId, b: string) {
		return base.toString() + TestIdPathParts.Delimiter + b;
	}

	public static parentId(idString: string) {
		const idx = idString.lastIndexOf(TestIdPathParts.Delimiter);
		return idx === -1 ? undefined : idString.slice(0, idx);
	}

	public static localId(idString: string) {
		const idx = idString.lastIndexOf(TestIdPathParts.Delimiter);
		return idx === -1 ? idString : idString.slice(idx + TestIdPathParts.Delimiter.length);
	}

	public static isChild(maybeParent: string, maybeChild: string) {
		return maybeChild[maybeParent.length] === TestIdPathParts.Delimiter && maybeChild.startsWith(maybeParent);
	}

	public static compare(a: string, b: string) {
		if (a === b) {
			return TestPosition.IsSame;
		}

		if (TestId.isChild(a, b)) {
			return TestPosition.IsChild;
		}

		if (TestId.isChild(b, a)) {
			return TestPosition.IsParent;
		}

		return TestPosition.Disconnected;
	}

	public static getLengthOfCommonPrefix(length: number, getId: (i: number) => TestId): number {
		if (length === 0) {
			return 0;
		}

		let commonPrefix = 0;
		while (commonPrefix < length - 1) {
			for (let i = 1; i < length; i++) {
				const a = getId(i - 1);
				const b = getId(i);
				if (a.path[commonPrefix] !== b.path[commonPrefix]) {
					return commonPrefix;
				}
			}

			commonPrefix++;
		}

		return commonPrefix;
	}

	constructor(
		public readonly path: readonly string[],
		private readonly viewEnd = path.length,
	) {
		if (path.length === 0 || viewEnd < 1) {
			throw new Error('cannot create test with empty path');
		}
	}

	public get rootId(): TestId {
		return new TestId(this.path, 1);
	}

	public get parentId(): TestId | undefined {
		return this.viewEnd > 1 ? new TestId(this.path, this.viewEnd - 1) : undefined;
	}

	public get localId() {
		return this.path[this.viewEnd - 1];
	}

	public get controllerId() {
		return this.path[0];
	}

	public get isRoot() {
		return this.viewEnd === 1;
	}

	public *idsFromRoot() {
		for (let i = 1; i <= this.viewEnd; i++) {
			yield new TestId(this.path, i);
		}
	}

	public *idsToRoot() {
		for (let i = this.viewEnd; i > 0; i--) {
			yield new TestId(this.path, i);
		}
	}

	public compare(other: TestId | string) {
		if (typeof other === 'string') {
			return TestId.compare(this.toString(), other);
		}

		for (let i = 0; i < other.viewEnd && i < this.viewEnd; i++) {
			if (other.path[i] !== this.path[i]) {
				return TestPosition.Disconnected;
			}
		}

		if (other.viewEnd > this.viewEnd) {
			return TestPosition.IsChild;
		}

		if (other.viewEnd < this.viewEnd) {
			return TestPosition.IsParent;
		}

		return TestPosition.IsSame;
	}

	public toJSON() {
		return this.toString();
	}

	public toString() {
		if (!this.stringifed) {
			this.stringifed = this.path[0];
			for (let i = 1; i < this.viewEnd; i++) {
				this.stringifed += TestIdPathParts.Delimiter;
				this.stringifed += this.path[i];
			}
		}

		return this.stringifed;
	}
}
