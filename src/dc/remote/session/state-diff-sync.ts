import { Emitter, Event } from '../../core/events/emitter.js';

export interface IStateDelta {
	readonly added: Record<string, unknown>;
	readonly removed: string[];
	readonly changed: Record<string, { readonly before: unknown; readonly after: unknown }>;
}

export interface IStateDiff {
	readonly added: Record<string, unknown>;
	readonly removed: string[];
	readonly changed: Record<string, { readonly before: unknown; readonly after: unknown }>;
}

export function isDeepEqual(a: unknown, b: unknown): boolean {
	if (a === b) {
		return true;
	}
	if (typeof a !== typeof b) {
		return false;
	}
	if (a === null || b === null) {
		return a === b;
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) {
			return false;
		}
		return a.every((value, index) => isDeepEqual(value, b[index]));
	}
	if (typeof a === 'object' && typeof b === 'object') {
		const aObj = a as Record<string, unknown>;
		const bObj = b as Record<string, unknown>;
		const aKeys = Object.keys(aObj);
		const bKeys = Object.keys(bObj);
		if (aKeys.length !== bKeys.length) {
			return false;
		}
		return aKeys.every(key => isDeepEqual(aObj[key], bObj[key]));
	}
	return false;
}

export function isEmptyDelta(delta: IStateDelta): boolean {
	return Object.keys(delta.added).length === 0 && delta.removed.length === 0 && Object.keys(delta.changed).length === 0;
}

export function createDelta(prev: Record<string, unknown>, next: Record<string, unknown>): IStateDelta {
	return diff(prev, next);
}

export function diff(prev: Record<string, unknown>, next: Record<string, unknown>): IStateDelta {
	const added: Record<string, unknown> = {};
	const removed: string[] = [];
	const changed: Record<string, { before: unknown; after: unknown }> = {};
	for (const [key, value] of Object.entries(next)) {
		if (!(key in prev)) {
			added[key] = value;
		} else if (!isDeepEqual(prev[key], value)) {
			changed[key] = { before: prev[key], after: value };
		}
	}
	for (const key of Object.keys(prev)) {
		if (!(key in next)) {
			removed.push(key);
		}
	}
	return { added, removed, changed };
}

export function applyDelta(base: Record<string, unknown>, delta: IStateDelta): Record<string, unknown> {
	const result: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(delta.added)) {
		result[key] = value;
	}
	for (const key of delta.removed) {
		delete result[key];
	}
	for (const [key, entry] of Object.entries(delta.changed)) {
		result[key] = entry.after;
	}
	return result;
}

export class StateDiffSync {
	private readonly _state: Record<string, unknown> = {};

	private readonly _onDidChange = new Emitter<IStateDelta>();
	readonly onDidChange: Event<IStateDelta> = this._onDidChange.event;

	get current(): Record<string, unknown> {
		return { ...this._state };
	}

	setState(next: Record<string, unknown>): IStateDelta {
		const delta = diff(this._state, next);
		for (const key of Object.keys(this._state)) {
			delete this._state[key];
		}
		Object.assign(this._state, next);
		if (!isEmptyDelta(delta)) {
			this._onDidChange.fire(delta);
		}
		return delta;
	}

	applyDelta(delta: IStateDelta): void {
		const next = applyDelta(this._state, delta);
		Object.assign(this._state, next);
		this._onDidChange.fire(delta);
	}

	get(key: string): unknown {
		return this._state[key];
	}

	set(key: string, value: unknown): void {
		if (isDeepEqual(this._state[key], value)) {
			return;
		}
		const before = this._state[key];
		const delta: IStateDelta = {
			added: key in this._state ? {} : { [key]: value },
			removed: [],
			changed: key in this._state ? { [key]: { before, after: value } } : {}
		};
		this._state[key] = value;
		this._onDidChange.fire(delta);
	}

	remove(key: string): void {
		if (!(key in this._state)) {
			return;
		}
		delete this._state[key];
		this._onDidChange.fire({ added: {}, removed: [key], changed: {} });
	}

	merge(other: Record<string, unknown>, preferOther = true): IStateDelta {
		const merged: Record<string, unknown> = preferOther ? { ...this._state, ...other } : { ...other, ...this._state };
		return this.setState(merged);
	}

	clear(): IStateDelta {
		const delta: IStateDelta = { added: {}, removed: Object.keys(this._state), changed: {} };
		for (const key of Object.keys(this._state)) {
			delete this._state[key];
		}
		this._onDidChange.fire(delta);
		return delta;
	}

	hasChanges(): boolean {
		return Object.keys(this._state).length > 0;
	}

	size(): number {
		return Object.keys(this._state).length;
	}
}

export function mergeDeltas(first: IStateDelta, second: IStateDelta): IStateDelta {
	const merged: IStateDelta = {
		added: { ...first.added, ...second.added },
		removed: [...new Set([...first.removed, ...second.removed])],
		changed: { ...first.changed, ...second.changed }
	};
	return merged;
}
