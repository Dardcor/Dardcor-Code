/**
 * Dardcor Code - CodeLens Location Resolution Cache
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { ITextModel } from "../../model/text-model.js";
import { ICodeLens } from "./codelens-controller.js";

export interface ICodeLensCacheEntry {
	readonly lens: ICodeLens;
	readonly resolved: boolean;
	readonly timestamp: number;
}

export interface ICodeLensCacheKey {
	readonly uri: string;
	readonly lineNumber: number;
	readonly column: number;
	readonly commandId: string;
}

const DEFAULT_MAX_ENTRIES = 256;

/**
 * Remembers CodeLens resolution results per model location. Providers often
 * return unresolved lenses (command title empty until resolved); caching the
 * resolved lens avoids re-running the expensive resolve step on every render.
 */
export class CodeLensCache extends Disposable {
	private readonly _entries = new Map<string, ICodeLensCacheEntry>();
	private readonly _maxEntries: number;

	constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
		super();
		this._maxEntries = maxEntries;
	}

	public static keyFor(model: ITextModel, lens: ICodeLens): string {
		return CodeLensCache.makeKey({
			uri: model.uri.toString(),
			lineNumber: lens.range.startLineNumber,
			column: lens.range.startColumn,
			commandId: lens.command.id
		});
	}

	public static makeKey(key: ICodeLensCacheKey): string {
		return `${key.uri}#${key.lineNumber}:${key.column}:${key.commandId}`;
	}

	public get(key: string): ICodeLensCacheEntry | null {
		const entry = this._entries.get(key);
		return entry ? { ...entry, lens: { ...entry.lens } } : null;
	}

	public getResolved(key: string): ICodeLens | null {
		const entry = this._entries.get(key);
		return entry && entry.resolved ? { ...entry.lens } : null;
	}

	public set(key: string, lens: ICodeLens, resolved: boolean): void {
		this._entries.set(key, { lens: { ...lens }, resolved, timestamp: Date.now() });
		this._evict();
	}

	public markResolved(key: string, lens: ICodeLens): void {
		this.set(key, lens, true);
	}

	public invalidate(key: string): void {
		this._entries.delete(key);
	}

	public invalidateForModel(uri: string): void {
		const prefix = `${uri}#`;
		for (const key of this._entries.keys()) {
			if (key.startsWith(prefix)) {
				this._entries.delete(key);
			}
		}
	}

	public clear(): void {
		this._entries.clear();
	}

	public get size(): number {
		return this._entries.size;
	}

	public getEntries(): readonly ICodeLensCacheEntry[] {
		return Array.from(this._entries.values()).map(entry => ({ ...entry, lens: { ...entry.lens } }));
	}

	public getResolvedLenses(): ICodeLens[] {
		const lenses: ICodeLens[] = [];
		for (const entry of this._entries.values()) {
			if (entry.resolved) {
				lenses.push({ ...entry.lens });
			}
		}
		return lenses;
	}

	private _evict(): void {
		if (this._entries.size <= this._maxEntries) {
			return;
		}
		const entries = Array.from(this._entries.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);
		const overflow = entries.length - this._maxEntries;
		for (let i = 0; i < overflow; i++) {
			this._entries.delete(entries[i][0]);
		}
	}
}

/**
 * Convenience cache scoped to a single document version. Call `bump(model)`
 * whenever the model content changes to drop stale entries.
 */
export class ModelScopedCodeLensCache extends CodeLensCache {
	private _lastVersion: number = -1;

	public bump(model: ITextModel): void {
		const version = model.getLineCount() + model.getValue().length;
		if (version !== this._lastVersion) {
			this._lastVersion = version;
			this.invalidateForModel(model.uri.toString());
		}
	}
}
