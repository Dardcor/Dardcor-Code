/**
 * Dardcor Code - Reference List Side Panel Inside Peek View
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, clearNode, addDisposableListener } from "../../../core/dom/element.js";
import { PeekViewWidget, IPeekViewAnchor } from "./peek-view-widget.js";
import { IReference } from "../references/references-controller.js";
import { ReferencesModel } from "../references/references-model.js";

export interface IReferencesPeekViewHost {
	previewReference(reference: IReference): string;
	revealReference(reference: IReference): void;
}

export class ReferencesPeekView extends Disposable {
	private readonly _widget: PeekViewWidget;
	private readonly _host: IReferencesPeekViewHost;
	private readonly _model: ReferencesModel;

	private readonly _onDidSelectReference = this._register(new Emitter<IReference>());
	readonly onDidSelectReference: Event<IReference> = this._onDidSelectReference.event;

	constructor(widget: PeekViewWidget, host: IReferencesPeekViewHost) {
		super();
		this._widget = widget;
		this._host = host;
		this._model = new ReferencesModel();
		this._register(this._model.onDidSelect(reference => {
			if (reference) {
				this._host.revealReference(reference);
			}
		}));
	}

	public show(anchor: IPeekViewAnchor, references: IReference[], word: string): void {
		this._model.setReferences(references);
		const count = references.length;
		const title = `${count} ${count === 1 ? "reference" : "references"} to "${word}"`;
		this._widget.show(anchor, title, this._buildList());
		this._register(this._widget.onDidClose(() => this.hide()));
	}

	public hide(): void {
		this._widget.hide();
	}

	public selectNext(): void {
		this._model.selectNext();
		this._syncSelection();
	}

	public selectPrevious(): void {
		this._model.selectPrevious();
		this._syncSelection();
	}

	public getModel(): ReferencesModel {
		return this._model;
	}

	public getDomNode(): HTMLElement {
		return this._widget.getBody();
	}

	private _buildList(): HTMLElement {
		const container = $<HTMLElement>("div", "dc-references-peek-view");
		container.style.cssText = "height:100%;overflow-y:auto;font-family:Consolas, monospace;font-size:13px;color:#d4d4d4;";
		const groups = this._model.getGroups();
		if (groups.length === 0) {
			const empty = $<HTMLElement>("div", "dc-references-peek-empty");
			empty.textContent = "No references found";
			empty.style.cssText = "padding:12px 16px;color:#969696;";
			container.appendChild(empty);
			return container;
		}
		for (const group of groups) {
			const header = $<HTMLElement>("div", "dc-references-peek-file");
			header.textContent = group.displayName;
			header.style.cssText = "padding:4px 12px;font-size:11px;color:#75beff;text-transform:uppercase;letter-spacing:0.5px;border-top:1px solid #3a3a3a;";
			container.appendChild(header);
			for (const reference of group.references) {
				const row = $<HTMLElement>("div", "dc-references-peek-item");
				row.style.cssText = "display:flex;gap:8px;padding:2px 16px;cursor:pointer;align-items:baseline;";
				const line = $<HTMLElement>("span", "dc-references-peek-line");
				line.textContent = String(reference.range.startLineNumber);
				line.style.cssText = "flex:none;min-width:28px;color:#6a9955;text-align:right;";
				const preview = $<HTMLElement>("span", "dc-references-peek-preview");
				const content = reference.preview ?? this._host.previewReference(reference);
				preview.textContent = content.trim().substring(0, 200);
				preview.style.cssText = "color:#b5b5b5;white-space:pre;overflow:hidden;text-overflow:ellipsis;";
				row.appendChild(line);
				row.appendChild(preview);
				this._register(addDisposableListener(row, "click", () => {
					this._model.selectReference(reference);
					this._onDidSelectReference.fire(reference);
					this._host.revealReference(reference);
				}));
				container.appendChild(row);
			}
		}
		return container;
	}

	private _syncSelection(): void {
		const reference = this._model.getCurrentReference();
		if (reference) {
			this._onDidSelectReference.fire(reference);
		}
	}

	public override dispose(): void {
		this._model.dispose();
		super.dispose();
	}
}
