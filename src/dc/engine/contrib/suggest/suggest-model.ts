/**
 * Dardcor Code - Suggestion List Provider Model
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { ITextModel, IPosition } from "../../model/text-model.js";
import { CompletionItem, CompletionItemKind, CompletionTriggerKind, compareCompletionItems } from "./completion-item.js";

export interface ISuggestProvider {
	provideCompletionItems(
		model: ITextModel,
		position: IPosition,
		triggerKind: CompletionTriggerKind
	): CompletionItem[] | Promise<CompletionItem[]>;
}

export interface ISuggestModelState {
	readonly isActive: boolean;
	readonly items: readonly CompletionItem[];
	readonly currentIndex: number;
	readonly query: string;
	readonly position: IPosition | null;
}

export interface ISuggestFilterResult {
	readonly item: CompletionItem;
	readonly score: number;
}

export function fuzzyScore(query: string, text: string): number {
	const q = query.toLowerCase();
	const t = text.toLowerCase();
	if (q.length === 0) {
		return 1;
	}
	if (t.indexOf(q) !== -1) {
		return 100 + q.length;
	}
	let qi = 0;
	let score = 0;
	let consecutive = 0;
	for (let i = 0; i < t.length && qi < q.length; i++) {
		if (t[i] === q[qi]) {
			qi++;
			consecutive++;
			score += 2 + consecutive;
			if (i > 0 && t[i - 1] === "_" || i > 0 && t[i - 1] === "-" || i > 0 && t[i - 1] === " ") {
				score += 5;
			}
		} else {
			consecutive = 0;
		}
	}
	return qi === q.length ? score : -1;
}

export class SuggestModel extends Disposable {
	private readonly _providers: ISuggestProvider[] = [];
	private _items: CompletionItem[] = [];
	private _filtered: CompletionItem[] = [];
	private _query: string = "";
	private _position: IPosition | null = null;
	private _isActive: boolean = false;
	private _currentIndex: number = 0;
	private _requestId: number = 0;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidAccept = this._register(new Emitter<CompletionItem>());
	readonly onDidAccept: Event<CompletionItem> = this._onDidAccept.event;

	public registerProvider(provider: ISuggestProvider): void {
		this._providers.push(provider);
	}

	public unregisterProvider(provider: ISuggestProvider): void {
		const index = this._providers.indexOf(provider);
		if (index !== -1) {
			this._providers.splice(index, 1);
		}
	}

	public async trigger(model: ITextModel, position: IPosition, triggerKind: CompletionTriggerKind = CompletionTriggerKind.Invoke): Promise<void> {
		const requestId = ++this._requestId;
		const results: CompletionItem[] = [];
		await Promise.all(this._providers.map(async provider => {
			try {
				const items = await provider.provideCompletionItems(model, position, triggerKind);
				if (items) {
					results.push(...items);
				}
			} catch {
				// A failing provider must not break the whole list
			}
		}));
		if (requestId !== this._requestId) {
			return;
		}
		this._items = this._dedupe(results);
		this._position = position;
		this._isActive = true;
		this._applyQuery();
	}

	private _dedupe(items: CompletionItem[]): CompletionItem[] {
		const seen = new Set<string>();
		const result: CompletionItem[] = [];
		for (const item of items) {
			const key = `${item.filterText}@${item.detail}`;
			if (!seen.has(key)) {
				seen.add(key);
				result.push(item);
			}
		}
		return result;
	}

	public setQuery(query: string): void {
		this._query = query;
		this._applyQuery();
	}

	private _applyQuery(): void {
		const matches: ISuggestFilterResult[] = [];
		for (const item of this._items) {
			const score = fuzzyScore(this._query, item.filterText);
			if (score !== -1) {
				item.score = score;
				matches.push({ item, score });
			}
		}
		matches.sort((a, b) => {
			if (b.score !== a.score) {
				return b.score - a.score;
			}
			return a.item.sortText.localeCompare(b.item.sortText);
		});
		this._filtered = matches.map(m => m.item);
		if (this._filtered.length === 0) {
			this._currentIndex = -1;
		} else {
			this._currentIndex = Math.max(0, Math.min(this._currentIndex, this._filtered.length - 1));
		}
		this._onDidChange.fire();
	}

	public selectNext(): void {
		if (this._filtered.length === 0) {
			return;
		}
		this._currentIndex = (this._currentIndex + 1) % this._filtered.length;
		this._onDidChange.fire();
	}

	public selectPrevious(): void {
		if (this._filtered.length === 0) {
			return;
		}
		this._currentIndex = (this._currentIndex - 1 + this._filtered.length) % this._filtered.length;
		this._onDidChange.fire();
	}

	public selectIndex(index: number): void {
		if (index < 0 || index >= this._filtered.length) {
			return;
		}
		this._currentIndex = index;
		this._onDidChange.fire();
	}

	public getCurrentItem(): CompletionItem | null {
		return this._currentIndex >= 0 ? this._filtered[this._currentIndex] ?? null : null;
	}

	public acceptCurrent(): void {
		const item = this.getCurrentItem();
		if (item) {
			this._onDidAccept.fire(item);
		}
	}

	public hide(): void {
		this._isActive = false;
		this._items = [];
		this._filtered = [];
		this._currentIndex = -1;
		this._requestId++;
		this._onDidChange.fire();
	}

	public getState(): ISuggestModelState {
		return {
			isActive: this._isActive,
			items: this._filtered,
			currentIndex: this._currentIndex,
			query: this._query,
			position: this._position
		};
	}

	public getProviders(): readonly ISuggestProvider[] {
		return this._providers;
	}
}

export function isWordCharacter(ch: string): boolean {
	return /[A-Za-z0-9_$]/.test(ch);
}

export function getWordAtPosition(model: ITextModel, position: IPosition): string {
	const line = model.getLineContent(position.lineNumber);
	let start = position.column - 1;
	while (start > 0 && isWordCharacter(line[start - 1])) {
		start--;
	}
	let end = position.column - 1;
	while (end < line.length && isWordCharacter(line[end])) {
		end++;
	}
	return line.substring(start, end);
}
