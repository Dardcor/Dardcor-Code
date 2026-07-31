import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';

export type SuggestionKind = 'method' | 'function' | 'class' | 'interface' | 'property' | 'variable' | 'constant' | 'keyword' | 'snippet' | 'text';

export interface SuggestionItem {
	readonly label: string;
	readonly detail?: string;
	readonly insertText?: string;
	readonly kind?: SuggestionKind;
	readonly documentation?: string;
	readonly sortText?: string;
	readonly filterText?: string;
}

export interface ISuggestProvider {
	(textBefore: string): SuggestionItem[];
}

function currentWordPrefix(textBefore: string): string {
	const match = /[A-Za-z0-9_$]*$/.exec(textBefore);
	return match ? match[0].toLowerCase() : '';
}

export class SuggestController extends Disposable {
	private _provider: ISuggestProvider | null = null;
	private _items: SuggestionItem[] = [];
	private _activeIndex = -1;
	private _isActive = false;
	private _textBefore = '';

	private readonly _onDidShowSuggestions = this._register(new Emitter<SuggestionItem[]>());
	readonly onDidShowSuggestions: Event<SuggestionItem[]> = this._onDidShowSuggestions.event;

	private readonly _onDidHideSuggestions = this._register(new Emitter<void>());
	readonly onDidHideSuggestions: Event<void> = this._onDidHideSuggestions.event;

	private readonly _onDidChangeActiveItem = this._register(new Emitter<SuggestionItem | null>());
	readonly onDidChangeActiveItem: Event<SuggestionItem | null> = this._onDidChangeActiveItem.event;

	public setProvider(provider: ISuggestProvider | null): void {
		this._provider = provider;
		if (!provider) {
			this.cancel();
		}
	}

	public getProvider(): ISuggestProvider | null {
		return this._provider;
	}

	public trigger(textBefore: string): boolean {
		if (!this._provider) {
			return false;
		}
		this._textBefore = textBefore;
		const all = this._provider(textBefore);
		const prefix = currentWordPrefix(textBefore);
		let filtered: SuggestionItem[];
		if (prefix.length === 0) {
			filtered = all.slice(0, 50);
		} else {
			filtered = all.filter(item => {
				const filterText = (item.filterText ?? item.label).toLowerCase();
				return filterText.indexOf(prefix) !== -1;
			}).slice(0, 50);
		}
		if (filtered.length === 0) {
			this.cancel();
			return false;
		}
		this._items = filtered;
		this._activeIndex = 0;
		this._isActive = true;
		this._onDidShowSuggestions.fire(this._items);
		this._onDidChangeActiveItem.fire(this.getActiveItem() ?? null);
		return true;
	}

	public triggerCharacter(character: string): boolean {
		return this.trigger(this._textBefore + character);
	}

	public cancel(): void {
		if (!this._isActive) {
			return;
		}
		this._isActive = false;
		this._items = [];
		this._activeIndex = -1;
		this._onDidHideSuggestions.fire();
		this._onDidChangeActiveItem.fire(null);
	}

	public acceptSelected(): SuggestionItem | undefined {
		const item = this.getActiveItem();
		if (item) {
			this.cancel();
		}
		return item;
	}

	public navigateUp(): void {
		this._moveIndex(-1);
	}

	public navigateDown(): void {
		this._moveIndex(1);
	}

	public navigateTo(index: number): void {
		if (!this._isActive || this._items.length === 0) {
			return;
		}
		this._activeIndex = Math.max(0, Math.min(index, this._items.length - 1));
		this._onDidChangeActiveItem.fire(this.getActiveItem() ?? null);
	}

	public isActive(): boolean {
		return this._isActive;
	}

	public getItems(): SuggestionItem[] {
		return this._items.slice();
	}

	public getItemCount(): number {
		return this._items.length;
	}

	public getActiveItem(): SuggestionItem | undefined {
		if (!this._isActive || this._activeIndex < 0 || this._activeIndex >= this._items.length) {
			return undefined;
		}
		return this._items[this._activeIndex];
	}

	public getActiveIndex(): number {
		return this._activeIndex;
	}

	public getTextBefore(): string {
		return this._textBefore;
	}

	public getCurrentPrefix(): string {
		return currentWordPrefix(this._textBefore);
	}

	private _moveIndex(delta: number): void {
		if (!this._isActive || this._items.length === 0) {
			return;
		}
		this._activeIndex = (this._activeIndex + delta + this._items.length) % this._items.length;
		this._onDidChangeActiveItem.fire(this.getActiveItem() ?? null);
	}
}
