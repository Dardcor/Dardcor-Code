import { Disposable } from '../../core/lifecycle/disposable.js';
import { $ } from '../../core/dom/element.js';

export interface ILineCard {
	readonly id: string;
	readonly title: string;
	readonly content: string;
	readonly lineNumber: number;
	readonly className?: string;
}

export class LineCards extends Disposable {
	private readonly _cards = new Map<string, HTMLDivElement>();
	private readonly _container: HTMLDivElement;

	constructor(container: HTMLElement) {
		super();
		this._container = $<HTMLDivElement>('div', 'dc-line-cards');
		this._container.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;overflow:hidden;z-index:15;';
		container.appendChild(this._container);
	}

	public showCard(card: ILineCard, lineHeight: number): void {
		let el = this._cards.get(card.id);
		if (!el) {
			el = $<HTMLDivElement>('div', card.className ?? 'dc-line-card');
			el.style.position = 'absolute';
			el.style.left = '0';
			el.style.right = '0';
			el.style.pointerEvents = 'auto';
			el.style.boxSizing = 'border-box';
			el.style.overflow = 'hidden';
			el.style.textOverflow = 'ellipsis';
			el.style.whiteSpace = 'nowrap';
			this._cards.set(card.id, el);
			this._container.appendChild(el);
		}
		el.className = card.className ?? 'dc-line-card';
		el.title = card.title;
		el.textContent = card.content;
		el.style.top = `${(card.lineNumber - 1) * Math.max(1, lineHeight)}px`;
		el.style.height = `${Math.max(1, lineHeight)}px`;
	}

	public updateCard(id: string, content: string, title?: string): void {
		const el = this._cards.get(id);
		if (el) {
			el.textContent = content;
			if (title !== undefined) {
				el.title = title;
			}
		}
	}

	public moveCard(id: string, lineNumber: number, lineHeight: number): void {
		const el = this._cards.get(id);
		if (el) {
			el.style.top = `${(lineNumber - 1) * Math.max(1, lineHeight)}px`;
		}
	}

	public hideCard(id: string): boolean {
		const el = this._cards.get(id);
		if (!el) {
			return false;
		}
		el.remove();
		return this._cards.delete(id);
	}

	public hasCard(id: string): boolean {
		return this._cards.has(id);
	}

	public getCardCount(): number {
		return this._cards.size;
	}

	public getCardIds(): string[] {
		return Array.from(this._cards.keys());
	}

	public clear(): void {
		for (const el of this._cards.values()) {
			el.remove();
		}
		this._cards.clear();
	}

	public getDomNode(): HTMLDivElement {
		return this._container;
	}

	override dispose(): void {
		this.clear();
		this._container.remove();
		super.dispose();
	}
}
