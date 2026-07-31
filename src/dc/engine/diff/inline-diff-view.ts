/**
 * Dardcor Code - Single-Column Unified Diff View Renderer (Task 239)
 * Mirrors: vs/editor/contrib/diffEditor/browser/diffEditorViewModel.ts (unified rendering)
 */

import { $ } from '../../core/dom/element.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';
import { ITextModel } from '../model/text-model.js';
import { DiffChange, computeLineDiff, splitLines } from './diff-change.js';

export interface IInlineDiffViewOptions {
	readonly lineHeight: number;
	readonly showLineNumbers: boolean;
	readonly renderAddedBackground: string;
	readonly renderRemovedBackground: string;
	readonly renderChangedBackground: string;
}

export interface IInlineDiffLine {
	readonly lineNumber: number;
	readonly content: string;
	readonly changeType: 'added' | 'removed' | 'context';
	readonly originalLineNumber: number;
}

export interface IInlineDiffRenderEvent {
	readonly lineCount: number;
	readonly changeCount: number;
}

export class InlineDiffView extends Disposable {
	private readonly _domNode: HTMLElement;
	private _changes: DiffChange[] = [];
	private _options: IInlineDiffViewOptions;

	private readonly _onDidRender = this._register(new Emitter<IInlineDiffRenderEvent>());
	readonly onDidRender: Event<IInlineDiffRenderEvent> = this._onDidRender.event;

	constructor(
		container: HTMLElement,
		private readonly _original: ITextModel,
		private readonly _modified: ITextModel,
		options: Partial<IInlineDiffViewOptions> = {}
	) {
		super();
		this._options = {
			lineHeight: options.lineHeight ?? 19,
			showLineNumbers: options.showLineNumbers ?? true,
			renderAddedBackground: options.renderAddedBackground ?? 'rgba(155,185,85,0.2)',
			renderRemovedBackground: options.renderRemovedBackground ?? 'rgba(255,0,0,0.15)',
			renderChangedBackground: options.renderChangedBackground ?? 'rgba(255,0,0,0.15)',
		};
		this._domNode = $<HTMLElement>('div', 'dc-inline-diff');
		this._domNode.style.cssText = 'position:relative;overflow:auto;font-family:Consolas,monospace;font-size:14px;';
		container.appendChild(this._domNode);
	}

	public computeChanges(): DiffChange[] {
		this._changes = computeLineDiff(splitLines(this._original.getValue()), splitLines(this._modified.getValue()));
		return [...this._changes];
	}

	public setChanges(changes: DiffChange[]): void {
		this._changes = [...changes];
	}

	public getChanges(): DiffChange[] {
		return [...this._changes];
	}

	public render(): void {
		const originalLines = splitLines(this._original.getValue());
		const modifiedLines = splitLines(this._modified.getValue());
		this.computeChanges();

		this._domNode.innerHTML = '';
		const rows: string[] = [];

		let originalIndex = 1;
		let modifiedIndex = 1;
		let renderLineNumber = 1;

		for (const change of this._changes) {
			while (originalIndex < change.originalStartLineNumber) {
				rows.push(this._renderRow(renderLineNumber++, originalIndex, originalLines[originalIndex - 1], 'context'));
				originalIndex++;
				modifiedIndex++;
			}

			const deleteLength = change.getOriginalLength();
			const insertLength = change.getModifiedLength();

			for (let k = 0; k < deleteLength; k++) {
				rows.push(this._renderRow(renderLineNumber++, originalIndex + k, originalLines[originalIndex + k - 1] ?? '', 'removed'));
			}
			for (let k = 0; k < insertLength; k++) {
				rows.push(this._renderRow(renderLineNumber++, originalIndex - 1, modifiedLines[modifiedIndex + k - 1] ?? '', 'added'));
			}

			originalIndex += deleteLength;
			modifiedIndex += insertLength;
		}

		while (originalIndex <= originalLines.length || modifiedIndex <= modifiedLines.length) {
			const originalLine = originalIndex <= originalLines.length ? originalLines[originalIndex - 1] : null;
			const modifiedLine = modifiedIndex <= modifiedLines.length ? modifiedLines[modifiedIndex - 1] : null;
			const content = modifiedLine ?? originalLine ?? '';
			rows.push(this._renderRow(renderLineNumber++, originalIndex, content, 'context'));
			if (originalLine !== null) {
				originalIndex++;
			}
			if (modifiedLine !== null) {
				modifiedIndex++;
			}
		}

		this._domNode.innerHTML = rows.join('');
		this._onDidRender.fire({ lineCount: renderLineNumber - 1, changeCount: this._changes.length });
	}

	private _renderRow(lineNumber: number, originalLineNumber: number, content: string, changeType: 'added' | 'removed' | 'context'): string {
		const background = changeType === 'added'
			? this._options.renderAddedBackground
			: changeType === 'removed'
				? this._options.renderRemovedBackground
				: 'transparent';
		const marker = changeType === 'added' ? '+' : changeType === 'removed' ? '-' : ' ';
		const escaped = this._escape(content);
		const gutter = this._options.showLineNumbers
			? `<span class="dc-diff-linenum">${String(changeType === 'removed' ? originalLineNumber : originalLineNumber).padStart(4)}</span>`
			: '';
		return `<div class="dc-diff-line dc-diff-${changeType}" style="height:${this._options.lineHeight}px;background:${background};">
			<span class="dc-diff-marker">${marker}</span>${gutter}<span class="dc-diff-content">${escaped}</span>
		</div>`;
	}

	private _escape(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/ /g, '&#160;');
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	public getChangeCount(): number {
		return this._changes.length;
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
