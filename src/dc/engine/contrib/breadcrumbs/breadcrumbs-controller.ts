/**
 * Dardcor Code - Top File Symbol Navigation Breadcrumb Bar
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, clearNode, addDisposableListener } from "../../../core/dom/element.js";
import { ITextModel, IPosition, IRange } from "../../model/text-model.js";
import { SymbolKind } from "../goto-symbol/goto-symbol.js";

export interface IBreadcrumbItem {
	readonly name: string;
	readonly kind: SymbolKind;
	readonly range: IRange;
}

export interface IBreadcrumbsHost {
	getDomNode(): HTMLElement;
	getModel(): ITextModel | null;
	getPosition(): IPosition | null;
	revealRange(range: IRange): void;
}

const SCOPE_PATTERNS: { regex: RegExp; kind: SymbolKind; nameGroup: number }[] = [
	{ regex: /^\s*(?:export\s+|declare\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Function, nameGroup: 1 },
	{ regex: /^\s*(?:export\s+)?(?:abstract\s+|final\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Class, nameGroup: 1 },
	{ regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Interface, nameGroup: 1 },
	{ regex: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Enum, nameGroup: 1 },
	{ regex: /^\s*(?:export\s+)?namespace\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/, kind: SymbolKind.Namespace, nameGroup: 1 },
	{ regex: /^\s*(?:type|abstract|readonly|static|public|private|protected|async)*\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/, kind: SymbolKind.Method, nameGroup: 1 }
];

export class BreadcrumbsController extends Disposable {
	private readonly _host: IBreadcrumbsHost;
	private readonly _barNode: HTMLElement;
	private _symbols: IBreadcrumbItem[] = [];
	private _activePath: IBreadcrumbItem[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidSelect = this._register(new Emitter<IBreadcrumbItem>());
	readonly onDidSelect: Event<IBreadcrumbItem> = this._onDidSelect.event;

	constructor(host: IBreadcrumbsHost) {
		super();
		this._host = host;
		this._barNode = $<HTMLElement>("div", "dc-breadcrumbs-bar");
		this._barNode.style.cssText = "display:flex;align-items:center;gap:2px;overflow-x:auto;white-space:nowrap;padding:0 8px;font-family:Segoe UI, sans-serif;font-size:12px;color:#cccccc;user-select:none;";
		host.getDomNode().appendChild(this._barNode);
		this._register(addDisposableListener(this._barNode, "click", e => {
			const target = (e.target as HTMLElement).closest(".dc-breadcrumb-item") as HTMLElement | null;
			if (target) {
				const item = this._activePath[Number(target.getAttribute("data-index"))];
				if (item) {
					this._onDidSelect.fire(item);
					this._host.revealRange(item.range);
				}
			}
		}));
	}

	public refresh(): void {
		const model = this._host.getModel();
		if (!model) {
			clearNode(this._barNode);
			this._symbols = [];
			this._activePath = [];
			this._onDidChange.fire();
			return;
		}
		this._symbols = this.computeSymbols(model);
		this._computeActivePath();
		this._render();
		this._onDidChange.fire();
	}

	public computeSymbols(model: ITextModel): IBreadcrumbItem[] {
		const symbols: IBreadcrumbItem[] = [];
		const lineCount = model.getLineCount();
		for (let line = 1; line <= lineCount; line++) {
			const text = model.getLineContent(line);
			for (const pattern of SCOPE_PATTERNS) {
				const match = pattern.regex.exec(text);
				if (match) {
					symbols.push({
						name: match[pattern.nameGroup],
						kind: pattern.kind,
						range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: Math.max(1, text.length) }
					});
					break;
				}
			}
		}
		return symbols;
	}

	private _computeActivePath(): void {
		const position = this._host.getPosition();
		this._activePath = [];
		if (!position) {
			return;
		}
		const path: IBreadcrumbItem[] = [];
		for (const symbol of this._symbols) {
			if (symbol.range.startLineNumber <= position.lineNumber) {
				// Keep last symbol that starts at or before the cursor line;
				// drop deeper symbols once a shallower one appears.
				while (path.length > 0 && path[path.length - 1].range.startLineNumber <= symbol.range.startLineNumber) {
					if (path[path.length - 1].range.endLineNumber >= position.lineNumber) {
						break;
					}
					path.pop();
				}
				path.push(symbol);
			}
		}
		this._activePath = path.filter(s => s.range.endLineNumber >= position.lineNumber);
	}

	private _render(): void {
		clearNode(this._barNode);
		const fileName = this._host.getModel()?.uri.path.split("/").pop() ?? "";
		this._barNode.appendChild(this._renderItem({ name: fileName, kind: SymbolKind.File, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } }, 0));
		for (let i = 0; i < this._activePath.length; i++) {
			const sep = $<HTMLElement>("span", "dc-breadcrumb-separator");
			sep.textContent = "/";
			sep.style.cssText = "color:#6a6a6a;margin:0 3px;";
			this._barNode.appendChild(sep);
			this._barNode.appendChild(this._renderItem(this._activePath[i], i + 1));
		}
	}

	private _renderItem(item: IBreadcrumbItem, index: number): HTMLElement {
		const el = $<HTMLElement>("span", "dc-breadcrumb-item");
		el.setAttribute("data-index", String(index));
		el.textContent = item.name;
		el.style.cssText = "cursor:pointer;padding:1px 4px;border-radius:2px;";
		el.title = `${item.name} (line ${item.range.startLineNumber})`;
		this._register(addDisposableListener(el, "mouseenter", () => {
			el.style.background = "#2a2d2e";
		}));
		this._register(addDisposableListener(el, "mouseleave", () => {
			el.style.background = "transparent";
		}));
		return el;
	}

	public getActivePath(): readonly IBreadcrumbItem[] {
		return this._activePath;
	}

	public getSymbols(): readonly IBreadcrumbItem[] {
		return this._symbols;
	}

	public getDomNode(): HTMLElement {
		return this._barNode;
	}

	public override dispose(): void {
		this._barNode.remove();
		super.dispose();
	}
}
