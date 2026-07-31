/**
 * Dardcor Code - Interactive Symbol Picker Breadcrumbs UI
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, clearNode, addDisposableListener } from "../../../core/dom/element.js";
import { IRange } from "../../model/text-model.js";
import { SymbolKind } from "../goto-symbol/goto-symbol.js";
import { BreadcrumbsModel } from "./breadcrumbs-model.js";
import { IDocumentSymbol } from "../goto-symbol/goto-symbol.js";

export interface IBreadcrumbsItem {
	readonly name: string;
	readonly kind: SymbolKind;
	readonly range: IRange;
}

export interface IBreadcrumbsWidgetHost {
	getDomNode(): HTMLElement;
	getModel(): BreadcrumbsModel | null;
	revealRange(range: IRange): void;
}

export interface IBreadcrumbsPickerEntry {
	readonly label: string;
	readonly kind: SymbolKind;
	readonly range: IRange;
	readonly detail: string;
}

/**
 * Breadcrumbs bar with dropdown pickers: clicking the file name lists all top
 * level symbols, clicking any symbol segment lists the symbols nested inside
 * it. Selection fires `onDidSelect` and reveals the range.
 */
export class BreadcrumbsWidget extends Disposable {
	private readonly _host: IBreadcrumbsWidgetHost;
	private readonly _barNode: HTMLElement;
	private _crumbs: IBreadcrumbsItem[] = [];
	private _pickerNode: HTMLElement | null = null;

	private readonly _onDidSelect = this._register(new Emitter<IBreadcrumbsItem>());
	readonly onDidSelect: Event<IBreadcrumbsItem> = this._onDidSelect.event;

	constructor(host: IBreadcrumbsWidgetHost) {
		super();
		this._host = host;
		this._barNode = $<HTMLElement>("div", "dc-breadcrumbs-widget");
		this._barNode.style.cssText = "display:flex;align-items:center;gap:2px;overflow-x:auto;white-space:nowrap;padding:0 8px;font-family:Segoe UI, sans-serif;font-size:12px;color:#cccccc;user-select:none;position:relative;";
		host.getDomNode().appendChild(this._barNode);
		this._register(addDisposableListener(document, "mousedown", (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (this._pickerNode && !this._barNode.contains(target)) {
				this._closePicker();
			}
		}));
	}

	public refresh(): void {
		const model = this._host.getModel();
		clearNode(this._barNode);
		this._crumbs = [];
		if (!model) {
			return;
		}
		const state = model.getState();
		this._renderFileCrumb(state.fileName, model.getSymbols());
		for (const symbol of state.activePath) {
			const item: IBreadcrumbsItem = {
				name: symbol.name,
				kind: symbol.kind,
				range: symbol.range
			};
			this._crumbs.push(item);
			this._barNode.appendChild(this._separator());
			this._barNode.appendChild(this._renderCrumb(item, this._findChildren(model, symbol)));
		}
	}

	public getCrumbs(): readonly IBreadcrumbsItem[] {
		return this._crumbs;
	}

	public getDomNode(): HTMLElement {
		return this._barNode;
	}

	private _renderFileCrumb(fileName: string, symbols: readonly IDocumentSymbol[]): void {
		const crumb = $<HTMLElement>("span", "dc-breadcrumb-item");
		crumb.textContent = fileName;
		crumb.style.cssText = "cursor:pointer;padding:1px 4px;border-radius:2px;";
		crumb.title = "Select top level symbol";
		this._register(addDisposableListener(crumb, "click", () => {
			this._openPicker(crumb, symbols.map(s => ({
				label: s.name,
				kind: s.kind,
				range: s.range,
				detail: s.detail
			})), (entry) => {
				this._onDidSelect.fire({ name: entry.label, kind: entry.kind, range: entry.range });
				this._host.revealRange(entry.range);
			});
		}));

		this._barNode.appendChild(crumb);
	}

	private _renderCrumb(item: IBreadcrumbsItem, children: readonly IBreadcrumbsPickerEntry[]): HTMLElement {
		const crumb = $<HTMLElement>("span", "dc-breadcrumb-item");
		crumb.textContent = item.name;
		crumb.style.cssText = "cursor:pointer;padding:1px 4px;border-radius:2px;color:#e8e8e8;";
		crumb.title = `${item.name} (line ${item.range.startLineNumber})`;
		this._register(addDisposableListener(crumb, "click", () => {
			this._openPicker(crumb, children, (entry) => {
				this._onDidSelect.fire({ name: entry.label, kind: entry.kind, range: entry.range });
				this._host.revealRange(entry.range);
			});
		}));
		return crumb;
	}

	private _findChildren(model: BreadcrumbsModel, symbol: IDocumentSymbol): IBreadcrumbsPickerEntry[] {
		const children: IBreadcrumbsPickerEntry[] = [];
		for (const candidate of model.getSymbols()) {
			if (candidate.range.startLineNumber <= symbol.range.startLineNumber) {
				continue;
			}
			if (candidate.range.endLineNumber <= symbol.range.endLineNumber) {
				children.push({
					label: candidate.name,
					kind: candidate.kind,
					range: candidate.range,
					detail: candidate.detail
				});
			}
		}
		return children;
	}

	private _openPicker(anchor: HTMLElement, entries: readonly IBreadcrumbsPickerEntry[], onPick: (entry: IBreadcrumbsPickerEntry) => void): void {
		this._closePicker();
		const picker = $<HTMLElement>("div", "dc-breadcrumbs-picker");
		picker.style.cssText = "position:absolute;z-index:70;min-width:220px;max-width:380px;max-height:260px;overflow-y:auto;background:#252526;border:1px solid #454545;border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,0.5);padding:4px 0;font-family:Consolas, monospace;font-size:13px;color:#d4d4d4;";
		if (entries.length === 0) {
			const empty = $<HTMLElement>("div");
			empty.textContent = "No symbols";
			empty.style.cssText = "padding:6px 14px;color:#969696;";
			picker.appendChild(empty);
		} else {
			for (const entry of entries) {
				const row = $<HTMLElement>("div", "dc-breadcrumbs-picker-item");
				row.style.cssText = "display:flex;gap:8px;padding:3px 14px;cursor:pointer;";
				const icon = $<HTMLElement>("span");
				icon.textContent = this._kindIcon(entry.kind);
				icon.style.cssText = "flex:none;width:16px;color:#75beff;";
				const label = $<HTMLElement>("span");
				label.textContent = entry.label;
				const line = $<HTMLElement>("span");
				line.textContent = `:${entry.range.startLineNumber}`;
				line.style.cssText = "margin-left:auto;color:#969696;font-size:11px;";
				row.appendChild(icon);
				row.appendChild(label);
				row.appendChild(line);
				this._register(addDisposableListener(row, "mouseenter", () => {
					row.style.background = "#2a2d2e";
				}));
				this._register(addDisposableListener(row, "mouseleave", () => {
					row.style.background = "transparent";
				}));
				this._register(addDisposableListener(row, "click", () => {
					this._closePicker();
					onPick(entry);
				}));
				picker.appendChild(row);
			}
		}
		const anchorRect = anchor.getBoundingClientRect();
		const barRect = this._barNode.getBoundingClientRect();
		picker.style.left = `${Math.max(0, anchorRect.left - barRect.left)}px`;
		picker.style.top = `${anchorRect.bottom - barRect.top}px`;
		this._barNode.appendChild(picker);
		this._pickerNode = picker;
	}

	private _closePicker(): void {
		this._pickerNode?.remove();
		this._pickerNode = null;
	}

	private _separator(): HTMLElement {
		const sep = $<HTMLElement>("span", "dc-breadcrumb-separator");
		sep.textContent = "/";
		sep.style.cssText = "color:#6a6a6a;margin:0 3px;";
		return sep;
	}

	private _kindIcon(kind: SymbolKind): string {
		switch (kind) {
			case SymbolKind.Class:
				return "C";
			case SymbolKind.Interface:
				return "I";
			case SymbolKind.Enum:
				return "E";
			case SymbolKind.Namespace:
				return "N";
			case SymbolKind.Method:
			case SymbolKind.Function:
				return "ƒ";
			default:
				return "•";
		}
	}

	public override dispose(): void {
		this._closePicker();
		this._barNode.remove();
		super.dispose();
	}
}
