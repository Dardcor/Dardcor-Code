/**
 * Dardcor Code - Find All References Results Presenter
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { CancellationToken } from "../../../core/async/cancellation.js";
import { $, clearNode, addDisposableListener } from "../../../core/dom/element.js";
import { URI } from "../../../core/types/uri.js";
import { ITextModel, IPosition, IRange } from "../../model/text-model.js";
import { PeekViewWidget, IPeekViewAnchor } from "../peek-view/peek-view-widget.js";

export interface IReference {
	readonly uri: URI;
	readonly range: IRange;
	readonly isDefinition: boolean;
	readonly preview?: string;
}

export interface IReferencesContext {
	readonly includeDeclaration: boolean;
}

export interface IReferencesProvider {
	provideReferences(
		model: ITextModel,
		position: IPosition,
		context: IReferencesContext,
		token: CancellationToken
	): IReference[] | null | Promise<IReference[] | null>;
}

export interface IReferencesHost {
	revealReference(reference: IReference): void;
	previewReference(reference: IReference): string;
}

export class ReferencesController extends Disposable {
	private readonly _providers: IReferencesProvider[] = [];
	private readonly _widget: PeekViewWidget;
	private _host: IReferencesHost | null = null;
	private _references: IReference[] = [];

	private readonly _onDidNavigate = this._register(new Emitter<IReference>());
	readonly onDidNavigate: Event<IReference> = this._onDidNavigate.event;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(widget: PeekViewWidget) {
		super();
		this._widget = widget;
	}

	public registerProvider(provider: IReferencesProvider): void {
		this._providers.push(provider);
	}

	public unregisterProvider(provider: IReferencesProvider): void {
		const index = this._providers.indexOf(provider);
		if (index !== -1) {
			this._providers.splice(index, 1);
		}
	}

	public setHost(host: IReferencesHost): void {
		this._host = host;
	}

	public async findReferences(model: ITextModel, position: IPosition): Promise<IReference[]> {
		const context: IReferencesContext = { includeDeclaration: true };
		const results: IReference[] = [];
		for (const provider of this._providers) {
			try {
				const refs = await provider.provideReferences(model, position, context, CancellationToken.None);
				if (refs) {
					results.push(...refs);
				}
			} catch {
				// Continue with next provider
			}
		}
		this._references = results;
		this._onDidChange.fire();
		return results;
	}

	public async present(anchor: IPeekViewAnchor, model: ITextModel, position: IPosition): Promise<void> {
		const word = this._wordAt(model, position);
		const references = await this.findReferences(model, position);
		const title = `${references.length} ${references.length === 1 ? "reference" : "references"} to "${word}"`;
		const list = this._buildList(references);
		this._widget.show(anchor, title, list);
	}

	public getReferences(): readonly IReference[] {
		return this._references;
	}

	public getReferenceCount(): number {
		return this._references.length;
	}

	private _buildList(references: IReference[]): HTMLElement {
		const list = $<HTMLElement>("div", "dc-references-list");
		list.style.cssText = "padding:8px 0;font-family:Consolas, monospace;font-size:13px;color:#d4d4d4;";
		if (references.length === 0) {
			const empty = $<HTMLElement>("div", "dc-references-empty");
			empty.textContent = "No references found";
			empty.style.cssText = "padding:12px 16px;color:#969696;";
			list.appendChild(empty);
			return list;
		}
		for (let i = 0; i < references.length; i++) {
			const reference = references[i];
			const row = $<HTMLElement>("div", "dc-references-item");
			row.setAttribute("data-index", String(i));
			row.style.cssText = "display:flex;gap:8px;padding:3px 16px;cursor:pointer;align-items:baseline;";
			const line = $<HTMLElement>("span", "dc-references-line");
			line.textContent = String(reference.range.startLineNumber);
			line.style.cssText = "flex:none;min-width:28px;color:#6a9955;text-align:right;";
			const preview = $<HTMLElement>("span", "dc-references-preview");
			const content = reference.preview ?? this._host?.previewReference(reference) ?? "";
			preview.textContent = content.trim().substring(0, 200);
			preview.style.cssText = "color:#b5b5b5;white-space:pre;overflow:hidden;text-overflow:ellipsis;";
			row.appendChild(line);
			row.appendChild(preview);
			this._register(addDisposableListener(row, "click", () => {
				this._onDidNavigate.fire(reference);
				this._host?.revealReference(reference);
			}));
			list.appendChild(row);
		}
		return list;
	}

	private _wordAt(model: ITextModel, position: IPosition): string {
		const line = model.getLineContent(position.lineNumber);
		const isWord = (ch: string) => /[A-Za-z0-9_$]/.test(ch);
		let start = position.column - 1;
		while (start > 0 && isWord(line[start - 1])) {
			start--;
		}
		let end = position.column - 1;
		while (end < line.length && isWord(line[end])) {
			end++;
		}
		return line.substring(start, end) || "selection";
	}
}
