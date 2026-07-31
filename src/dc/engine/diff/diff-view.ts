/**
 * Dardcor Code - Dual-Pane Diff Code Editor Component (Task 229)
 * Mirrors: vs/editor/contrib/diffEditor/diffEditorWidget.ts
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { $, clearNode } from '../../core/dom/element.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { ITextModel } from '../model/text-model.js';
import { DiffChangeType, DiffComputer, IDiffChange } from './diff-computer.js';

export interface IDiffViewOptions {
	readonly lineHeight?: number;
	readonly fontSize?: number;
	readonly readOnly?: boolean;
	readonly originalLabel?: string;
	readonly modifiedLabel?: string;
}

const MAX_RENDERED_LINES = 4000;

interface IPane {
	readonly root: HTMLElement;
	readonly header: HTMLElement;
	readonly gutter: HTMLElement;
	readonly lines: HTMLElement;
}

export class DiffView extends Disposable {
	private _original: ITextModel | null = null;
	private _modified: ITextModel | null = null;
	private _changes: IDiffChange[] = [];
	private _navigatorIndex = -1;

	private readonly _domNode: HTMLElement;
	private readonly _paneA: IPane;
	private readonly _paneB: IPane;

	private readonly _onDidNavigate = this._register(new Emitter<IDiffChange | null>());
	readonly onDidNavigate: Event<IDiffChange | null> = this._onDidNavigate.event;

	constructor(
		private readonly _options: IDiffViewOptions = {}
	) {
		super();
		this._domNode = $<HTMLElement>('div', 'dc-diff-view');
		this._paneA = this._createPane('Original', this._options.originalLabel ?? 'Original');
		this._paneB = this._createPane('Modified', this._options.modifiedLabel ?? 'Modified');
		this._domNode.appendChild(this._paneA.root);
		this._domNode.appendChild(this._paneB.root);
		this._syncPaneScroll();
	}

	getDomNode(): HTMLElement {
		return this._domNode;
	}

	setModels(original: ITextModel | null, modified: ITextModel | null): void {
		this._original = original;
		this._modified = modified;
		this._changes = [];
		this._navigatorIndex = -1;
		this.render();
	}

	getChanges(): IDiffChange[] {
		return this._changes;
	}

	render(): void {
		if (!this._original || !this._modified) {
			clearNode(this._paneA.lines);
			clearNode(this._paneB.lines);
			return;
		}
		this._changes = new DiffComputer(this._original, this._modified).compute().changes;
		this._renderPane(this._paneA, this._original, true);
		this._renderPane(this._paneB, this._modified, false);
	}

	navigateNext(): IDiffChange | null {
		return this._navigate(1);
	}

	navigatePrev(): IDiffChange | null {
		return this._navigate(-1);
	}

	private _navigate(direction: 1 | -1): IDiffChange | null {
		if (this._changes.length === 0) {
			return null;
		}
		this._navigatorIndex = (this._navigatorIndex + direction + this._changes.length) % this._changes.length;
		const change = this._changes[this._navigatorIndex];
		this._scrollToChange(change);
		this._onDidNavigate.fire(change);
		return change;
	}

	private _scrollToChange(change: IDiffChange): void {
		const lineHeight = this._options.lineHeight ?? 20;
		const targetLine = change.modifiedStart;
		this._paneB.lines.scrollTop = Math.max(0, (targetLine - 1) * lineHeight);
		this._syncPaneScroll();
	}

	private _createPane(className: string, label: string): IPane {
		const root = $<HTMLElement>('div', `dc-diff-pane ${className}`);
		const header = $<HTMLElement>('div', 'dc-diff-pane-header', label);
		const gutter = $<HTMLElement>('div', 'dc-diff-gutter');
		const lines = $<HTMLElement>('div', 'dc-diff-lines');
		root.appendChild(header);
		root.appendChild(gutter);
		root.appendChild(lines);
		return { root, header, gutter, lines };
	}

	private _renderPane(pane: IPane, model: ITextModel, isOriginal: boolean): void {
		clearNode(pane.gutter);
		clearNode(pane.lines);
		const lineCount = model.getLineCount();
		const lineHeight = this._options.lineHeight ?? 20;

		if (lineCount > MAX_RENDERED_LINES) {
			pane.lines.appendChild(this._createLine(`Diff truncated: ${lineCount} lines`, 'dc-diff-line dc-diff-truncated', lineHeight));
			return;
		}

		for (let line = 1; line <= lineCount; line++) {
			const change = this._changes.find(c => isOriginal
				? line >= c.originalStart && line <= c.originalEnd && c.type !== DiffChangeType.Insert
				: line >= c.modifiedStart && line <= c.modifiedEnd && c.type !== DiffChangeType.Delete);

			const lineEl = this._createLine(model.getLineContent(line), 'dc-diff-line', lineHeight);
			if (change) {
				lineEl.classList.add(`dc-diff-${change.type}`);
				if (change.type === DiffChangeType.Insert) {
					lineEl.classList.add('dc-diff-insert');
				} else if (change.type === DiffChangeType.Delete) {
					lineEl.classList.add('dc-diff-delete');
				} else {
					lineEl.classList.add('dc-diff-modify');
				}
			}
			pane.lines.appendChild(lineEl);

			const gutterEl = $<HTMLElement>('div', 'dc-diff-gutter-line', String(line));
			if (change) {
				const marker = change.type === DiffChangeType.Insert ? '+' : change.type === DiffChangeType.Delete ? '-' : '\u00B7';
				gutterEl.classList.add(`dc-diff-gutter-${change.type}`);
				gutterEl.textContent = marker;
			}
			pane.gutter.appendChild(gutterEl);
		}

		pane.gutter.style.height = `${lineCount * lineHeight}px`;
		pane.lines.style.height = `${lineCount * lineHeight}px`;
	}

	private _createLine(text: string, className: string, lineHeight: number): HTMLElement {
		const el = $<HTMLElement>('div', className);
		el.textContent = text === '' ? '\u00A0' : text;
		el.style.cssText = `height:${lineHeight}px;line-height:${lineHeight}px;white-space:pre;overflow:hidden;`;
		return el;
	}

	private _syncPaneScroll(): void {
		const { gutter: gutterA, lines: linesA } = this._paneA;
		const { gutter: gutterB, lines: linesB } = this._paneB;

		const syncToB = () => {
			gutterA.scrollTop = linesB.scrollTop;
			linesA.scrollTop = linesB.scrollTop;
		};
		const syncToA = () => {
			gutterB.scrollTop = linesA.scrollTop;
			linesB.scrollTop = linesA.scrollTop;
		};

		linesB.addEventListener('scroll', syncToB);
		linesA.addEventListener('scroll', syncToA);
		gutterB.addEventListener('scroll', () => { linesB.scrollTop = gutterB.scrollTop; });
		gutterA.addEventListener('scroll', () => { linesA.scrollTop = gutterA.scrollTop; });

		this._register({ dispose: () => {
			linesB.removeEventListener('scroll', syncToB);
			linesA.removeEventListener('scroll', syncToA);
		} });
	}
}
