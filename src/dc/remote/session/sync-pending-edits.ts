import { Emitter, Event } from '../../core/events/emitter';
import { generateUuid } from '../../core/types/uuid';

export interface IPendingEditOp {
	readonly offset: number;
	readonly length: number;
	readonly text: string;
}

export interface IPendingEdit {
	readonly id: string;
	readonly uri: string;
	readonly edits: IPendingEditOp[];
	readonly createdAt: number;
}

export function applyEditsToText(content: string, edits: IPendingEditOp[]): string {
	const sorted = [...edits].sort((a, b) => b.offset - a.offset);
	let result = content;
	for (const edit of sorted) {
		const offset = Math.max(0, Math.min(edit.offset, result.length));
		const length = Math.max(0, Math.min(edit.length, result.length - offset));
		result = result.slice(0, offset) + edit.text + result.slice(offset + length);
	}
	return result;
}

export class SyncPendingEdits {
	private readonly _pending = new Map<string, IPendingEdit[]>();

	private readonly _onDidAdd = new Emitter<{ uri: string; edit: IPendingEdit }>();
	readonly onDidAdd: Event<{ uri: string; edit: IPendingEdit }> = this._onDidAdd.event;

	private readonly _onDidClear = new Emitter<string>();
	readonly onDidClear: Event<string> = this._onDidClear.event;

	get pendingCount(): number {
		let count = 0;
		for (const edits of this._pending.values()) {
			count += edits.length;
		}
		return count;
	}

	add(uri: string, edit: IPendingEditOp | IPendingEditOp[]): IPendingEdit {
		const ops = Array.isArray(edit) ? edit : [edit];
		const entry: IPendingEdit = {
			id: generateUuid(),
			uri,
			edits: ops.map(op => ({ offset: op.offset, length: op.length, text: op.text })),
			createdAt: Date.now()
		};
		const existing = this._pending.get(uri) ?? [];
		existing.push(entry);
		this._pending.set(uri, existing);
		this._onDidAdd.fire({ uri, edit: entry });
		return entry;
	}

	get(uri: string): IPendingEdit[] {
		return [...(this._pending.get(uri) ?? [])];
	}

	getAll(): IPendingEdit[] {
		const result: IPendingEdit[] = [];
		for (const edits of this._pending.values()) {
			result.push(...edits);
		}
		return result;
	}

	remove(uri: string, id: string): boolean {
		const edits = this._pending.get(uri);
		if (!edits) {
			return false;
		}
		const index = edits.findIndex(entry => entry.id === id);
		if (index === -1) {
			return false;
		}
		edits.splice(index, 1);
		if (edits.length === 0) {
			this._pending.delete(uri);
		}
		return true;
	}

	clear(uri: string): void {
		if (this._pending.delete(uri)) {
			this._onDidClear.fire(uri);
		}
	}

	clearAll(): void {
		for (const uri of [...this._pending.keys()]) {
			this.clear(uri);
		}
	}

	getPendingDocs(): string[] {
		return [...this._pending.keys()];
	}

	hasPending(uri?: string): boolean {
		if (uri) {
			return (this._pending.get(uri)?.length ?? 0) > 0;
		}
		return this._pending.size > 0;
	}

	getPendingCount(uri?: string): number {
		if (uri) {
			return this._pending.get(uri)?.length ?? 0;
		}
		return this.pendingCount;
	}

	mergeWithRemote(uri: string, localEdits: IPendingEditOp[], remoteContent: string): string {
		return applyEditsToText(remoteContent, localEdits);
	}

	applyPending(uri: string, remoteContent: string): string {
		const edits = this._pending.get(uri);
		if (!edits || edits.length === 0) {
			return remoteContent;
		}
		const ops = edits.flatMap(entry => entry.edits);
		return applyEditsToText(remoteContent, ops);
	}

	acknowledge(uri: string, ids?: string[]): number {
		const edits = this._pending.get(uri);
		if (!edits) {
			return 0;
		}
		let removed = 0;
		if (!ids) {
			removed = edits.length;
			this._pending.delete(uri);
			this._onDidClear.fire(uri);
			return removed;
		}
		for (const id of ids) {
			if (this.remove(uri, id)) {
				removed++;
			}
		}
		return removed;
	}

	toJson(): string {
		return JSON.stringify(this.getAll(), null, 2);
	}
}
