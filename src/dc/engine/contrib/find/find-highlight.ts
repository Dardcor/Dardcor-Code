/**
 * Dardcor Code - Find Search Result Match Line Highlighter
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { $, clearNode } from "../../../core/dom/element.js";
import { ITextModel, IRange } from "../../model/text-model.js";
import { FindModel, IFindMatch } from "./find-model.js";

export interface IFindHighlightHost {
	getContainer(): HTMLElement;
	getLineTop(lineNumber: number): number;
	getLineHeight(): number;
}

export interface IFindHighlight {
	readonly range: IRange;
	readonly isCurrent: boolean;
}

/**
 * Renders an overlay of match highlights over the editor. Every search match
 * gets a translucent background block; the current match is highlighted more
 * strongly. `revealCurrent` scrolls the current match into view by asking the
 * host for the line position.
 */
export class FindHighlight extends Disposable {
	private readonly _host: IFindHighlightHost;
	private readonly _findModel: FindModel;
	private readonly _domNode: HTMLElement;
	private _highlights: IFindHighlight[] = [];

	constructor(host: IFindHighlightHost, findModel: FindModel) {
		super();
		this._host = host;
		this._findModel = findModel;
		this._domNode = $<HTMLElement>("div", "dc-find-highlight-layer");
		this._domNode.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:7;";
		host.getContainer().appendChild(this._domNode);
		this._register(findModel.onDidChange(() => this.render()));
	}

	public render(): void {
		clearNode(this._domNode);
		this._highlights = [];
		const matches = this._findModel.getMatches();
		const current = this._findModel.getCurrentMatch();
		for (const match of matches) {
			this._highlights.push({
				range: match.range,
				isCurrent: current !== null && this._isSameMatch(match, current)
			});
		}
		for (const highlight of this._highlights) {
			this._domNode.appendChild(this._renderBlock(highlight));
		}
	}

	public revealCurrent(scrollIntoView: boolean = true): void {
		const match = this._findModel.getCurrentMatch();
		if (!match) {
			return;
		}
		const top = this._host.getLineTop(match.range.startLineNumber);
		if (scrollIntoView && this._domNode.parentElement) {
			const container = this._domNode.parentElement;
			const rect = container.getBoundingClientRect();
			if (top < rect.top || top > rect.bottom - this._host.getLineHeight()) {
				container.scrollTop += top - rect.top - rect.height / 2;
			}
		}
	}

	public getHighlights(): readonly IFindHighlight[] {
		return this._highlights.map(h => ({ ...h, range: { ...h.range } }));
	}

	public clear(): void {
		this._highlights = [];
		clearNode(this._domNode);
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	private _renderBlock(highlight: IFindHighlight): HTMLElement {
		const block = $<HTMLElement>("div", "dc-find-highlight-block");
		const top = this._host.getLineTop(highlight.range.startLineNumber);
		const lineHeight = this._host.getLineHeight();
		block.style.cssText = `position:absolute;left:0;right:0;top:${Math.round(top)}px;height:${lineHeight}px;`;
		block.style.background = highlight.isCurrent ? "rgba(255, 200, 0, 0.35)" : "rgba(117, 190, 255, 0.18)";
		block.style.borderLeft = highlight.isCurrent ? "3px solid #e5c07b" : "none";
		return block;
	}

	private _isSameMatch(a: IFindMatch, b: IFindMatch): boolean {
		return a.range.startLineNumber === b.range.startLineNumber &&
			a.range.startColumn === b.range.startColumn &&
			a.range.endColumn === b.range.endColumn;
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}

export function isModelEmpty(model: ITextModel): boolean {
	return model.getLineCount() <= 1 && model.getLineContent(1).length === 0;
}
