/**
 * Dardcor Code - AI Ghost Text Inline Completion Manager
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { CancellationToken } from "../../../core/async/cancellation.js";
import { $, clearNode } from "../../../core/dom/element.js";
import { ITextModel, IPosition, IRange } from "../../model/text-model.js";

export type InlineCompletionTriggerKind = "invoke" | "automatic";

export interface IInlineCompletionContext {
	readonly triggerKind: InlineCompletionTriggerKind;
	readonly selectedSuggestionInfo?: unknown;
}

export interface IInlineCompletion {
	readonly insertText: string;
	readonly range?: IRange;
	readonly additionalTextEdits?: { range: IRange; text: string }[];
	readonly command?: { id: string; arguments?: unknown[] };
}

export interface IInlineCompletionProvider {
	provideInlineCompletions(
		model: ITextModel,
		position: IPosition,
		context: IInlineCompletionContext,
		token: CancellationToken
	): IInlineCompletion[] | null | Promise<IInlineCompletion[] | null>;
}

export interface IInlineCompletionHost {
	getContainer(): HTMLElement;
	getCoordinates(lineNumber: number, column: number): { x: number; y: number; height: number } | null;
	getValue(): string;
	getLineCount(): number;
}

export class InlineCompletionsController extends Disposable {
	private readonly _providers: IInlineCompletionProvider[] = [];
	private readonly _host: IInlineCompletionHost;
	private readonly _domNode: HTMLElement;
	private _model: ITextModel | null = null;
	private _position: IPosition | null = null;
	private _completion: IInlineCompletion | null = null;
	private _timer: any = null;
	private _requestId: number = 0;
	private _isDirty: boolean = false;

	private readonly _onDidChange = this._register(new Emitter<IInlineCompletion | null>());
	readonly onDidChange: Event<IInlineCompletion | null> = this._onDidChange.event;

	constructor(host: IInlineCompletionHost) {
		super();
		this._host = host;
		this._domNode = $<HTMLElement>("span", "dc-ghost-text");
		this._domNode.style.cssText = "position:absolute;z-index:35;display:none;pointer-events:none;color:#6a6a6a;font-family:Consolas, monospace;font-size:14px;white-space:pre;opacity:0.9;";
		host.getContainer().appendChild(this._domNode);
	}

	public registerProvider(provider: IInlineCompletionProvider): void {
		this._providers.push(provider);
	}

	public unregisterProvider(provider: IInlineCompletionProvider): void {
		const index = this._providers.indexOf(provider);
		if (index !== -1) {
			this._providers.splice(index, 1);
		}
	}

	public setModel(model: ITextModel | null): void {
		this._model = model;
		this.dismiss();
	}

	public setDirty(dirty: boolean): void {
		this._isDirty = dirty;
	}

	public trigger(position: IPosition, triggerKind: InlineCompletionTriggerKind = "automatic"): Promise<IInlineCompletion | null> {
		this._position = position;
		if (this._timer) {
			clearTimeout(this._timer);
		}
		return new Promise(resolve => {
			this._timer = setTimeout(async () => {
				this._timer = null;
				const result = await this._compute(position, triggerKind);
				resolve(result);
			}, triggerKind === "invoke" ? 0 : 75);
		});
	}

	private async _compute(position: IPosition, triggerKind: InlineCompletionTriggerKind): Promise<IInlineCompletion | null> {
		const model = this._model;
		if (!model || this._providers.length === 0) {
			return null;
		}
		const requestId = ++this._requestId;
		const context: IInlineCompletionContext = { triggerKind };
		for (const provider of this._providers) {
			try {
				const completions = await provider.provideInlineCompletions(model, position, context, CancellationToken.None);
				if (requestId !== this._requestId) {
					return null;
				}
				if (completions && completions.length > 0) {
					this._completion = completions[0];
					this._render();
					this._onDidChange.fire(this._completion);
					return this._completion;
				}
			} catch {
				// Try the next provider
			}
		}
		return null;
	}

	public accept(): boolean {
		const completion = this._completion;
		const model = this._model;
		const position = this._position;
		if (!completion || !model || !position) {
			return false;
		}
		const insertText = completion.insertText;
		if (completion.additionalTextEdits && completion.additionalTextEdits.length > 0) {
			this._applyWithEdits(model, insertText, completion.additionalTextEdits);
		} else {
			this._insertAt(model, position, insertText);
		}
		this.dismiss();
		return true;
	}

	public dismiss(): void {
		this._requestId++;
		if (this._timer) {
			clearTimeout(this._timer);
			this._timer = null;
		}
		this._completion = null;
		this._position = null;
		this._domNode.style.display = "none";
		this._onDidChange.fire(null);
	}

	public getCurrentCompletion(): IInlineCompletion | null {
		return this._completion;
	}

	public hasCompletion(): boolean {
		return this._completion !== null;
	}

	private _insertAt(model: ITextModel, position: IPosition, text: string): void {
		const offsets = this._computeLineOffsets(model);
		const offset = offsets[position.lineNumber - 1] + (position.column - 1);
		const value = model.getValue();
		model.setValue(value.substring(0, offset) + text + value.substring(offset));
	}

	private _applyWithEdits(model: ITextModel, insertText: string, edits: { range: IRange; text: string }[]): void {
		const value = model.getValue();
		const offsets = this._computeLineOffsets(model);
		const offsetOf = (range: IRange) => offsets[range.startLineNumber - 1] + (range.startColumn - 1);
		const endOf = (range: IRange) => offsets[range.endLineNumber - 1] + (range.endColumn - 1);
		const sorted = [...edits].sort((a, b) => offsetOf(b.range) - offsetOf(a.range));
		let result = value;
		for (const edit of sorted) {
			const start = offsetOf(edit.range);
			const end = endOf(edit.range);
			result = result.substring(0, start) + edit.text + result.substring(end);
		}
		if (this._position && insertText) {
			const position = this._position;
			const insertOffset = offsets[position.lineNumber - 1] + (position.column - 1);
			result = result.substring(0, insertOffset) + insertText + result.substring(insertOffset);
		}
		if (result !== value) {
			model.setValue(result);
		}
	}

	private _computeLineOffsets(model: ITextModel): number[] {
		const offsets: number[] = [0];
		for (let line = 1; line <= model.getLineCount(); line++) {
			offsets.push(offsets[offsets.length - 1] + model.getLineContent(line).length + 1);
		}
		return offsets;
	}

	private _render(): void {
		clearNode(this._domNode);
		const completion = this._completion;
		const position = this._position;
		if (!completion || !position) {
			return;
		}
		const anchor = this._host.getCoordinates(position.lineNumber, position.column);
		if (!anchor) {
			return;
		}
		this._domNode.textContent = completion.insertText;
		this._domNode.style.display = "inline";
		this._domNode.style.left = `${anchor.x}px`;
		this._domNode.style.top = `${anchor.y}px`;
	}

	public getGhostTextNode(): HTMLElement {
		return this._domNode;
	}

	public override dispose(): void {
		if (this._timer) {
			clearTimeout(this._timer);
		}
		this._domNode.remove();
		super.dispose();
	}
}
