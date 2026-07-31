/**
 * Dardcor Code - Fold Collapse Icon Gutter Renderer
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, clearNode, addDisposableListener } from "../../../core/dom/element.js";
import { FoldingModel } from "./folding-model.js";
import { FoldingRegion } from "./folding-region.js";

export interface IFoldingDecorationsHost {
	getContainer(): HTMLElement;
	getLineTop(lineNumber: number): number;
}

export interface IFoldingDecoration {
	readonly region: FoldingRegion;
	readonly isCollapsed: boolean;
}

/**
 * Renders the fold/unfold icons into the editor gutter. Each region gets one
 * icon at its start line; collapsed regions additionally hide the covered
 * range by marking it with a special class so the editor can render the
 * ellipsis line.
 */
export class FoldingDecorations extends Disposable {
	private readonly _host: IFoldingDecorationsHost;
	private readonly _domNode: HTMLElement;
	private readonly _foldingModel: FoldingModel;
	private _icons: Map<number, HTMLElement> = new Map();

	private readonly _onDidToggle = this._register(new Emitter<number>());
	readonly onDidToggle: Event<number> = this._onDidToggle.event;

	constructor(host: IFoldingDecorationsHost, foldingModel: FoldingModel) {
		super();
		this._host = host;
		this._foldingModel = foldingModel;
		this._domNode = $<HTMLElement>("div", "dc-folding-decorations");
		this._domNode.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:8;";
		host.getContainer().appendChild(this._domNode);
		this._register(this._foldingModel.onDidChange(() => this.render()));
	}

	public render(): void {
		clearNode(this._domNode);
		this._icons.clear();
		const regions = this._foldingModel.getAllRegions();
		for (const region of regions) {
			if (region.isRoot) {
				continue;
			}
			const lineTop = this._host.getLineTop(region.startLineNumber);
			this._domNode.appendChild(this._renderIcon(region, lineTop));
		}
	}

	public getDecorationAt(lineNumber: number): IFoldingDecoration | null {
		const regions = this._foldingModel.getRegionsAtLine(lineNumber);
		const region = regions[regions.length - 1] ?? null;
		if (!region || region.isRoot) {
			return null;
		}
		return { region, isCollapsed: region.isCollapsed };
	}

	public getVisibleDecorations(): IFoldingDecoration[] {
		return this._foldingModel
			.getAllRegions()
			.filter(r => !r.isRoot)
			.map(region => ({ region, isCollapsed: region.isCollapsed }));
	}

	private _renderIcon(region: FoldingRegion, top: number): HTMLElement {
		const icon = $<HTMLElement>("span", "dc-folding-icon");
		icon.style.cssText = `position:absolute;left:2px;top:${Math.round(top)}px;width:14px;height:14px;pointer-events:auto;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#9e9e9e;font-size:9px;font-family:Consolas, monospace;border-radius:2px;`;
		icon.textContent = region.isCollapsed ? "▶" : "▼";
		icon.title = region.isCollapsed ? `Expand region (lines ${region.startLineNumber}-${region.endLineNumber})` : `Collapse region (lines ${region.startLineNumber}-${region.endLineNumber})`;
		this._register(addDisposableListener(icon, "mouseenter", () => {
			icon.style.background = "#2a2d2e";
		}));
		this._register(addDisposableListener(icon, "mouseleave", () => {
			icon.style.background = "transparent";
		}));
		this._register(addDisposableListener(icon, "mousedown", e => e.preventDefault()));
		this._register(addDisposableListener(icon, "click", e => {
			e.preventDefault();
			e.stopPropagation();
			this._foldingModel.toggle(region.startLineNumber);
			this._onDidToggle.fire(region.startLineNumber);
		}));
		this._icons.set(region.startLineNumber, icon);
		return icon;
	}

	public getIconAtLine(lineNumber: number): HTMLElement | null {
		return this._icons.get(lineNumber) ?? null;
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
