/**
 * Dardcor Code - Inline Inlay Hints Controller
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { CancellationToken } from "../../../core/async/cancellation.js";
import { $, clearNode, addDisposableListener } from "../../../core/dom/element.js";
import { ITextModel, IPosition, IRange } from "../../model/text-model.js";

export enum InlayHintKind {
	Type = 1,
	Parameter = 2
}

export interface IInlayHint {
	readonly text: string;
	readonly position: IPosition;
	readonly kind?: InlayHintKind;
	readonly paddingLeft?: boolean;
	readonly paddingRight?: boolean;
}

export interface IInlayHintsProvider {
	provideInlayHints(model: ITextModel, range: IRange, token: CancellationToken): IInlayHint[] | Promise<IInlayHint[]>;
}

export interface IInlayHintsHost {
	getContainer(): HTMLElement;
	getCoordinates(lineNumber: number, column: number): { x: number; y: number; height: number } | null;
}

export class InlayHintsController extends Disposable {
	private readonly _providers: IInlayHintsProvider[] = [];
	private readonly _host: IInlayHintsHost;
	private readonly _domNode: HTMLElement;
	private _model: ITextModel | null = null;
	private _hints: IInlayHint[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(host: IInlayHintsHost) {
		super();
		this._host = host;
		this._domNode = $<HTMLElement>("div", "dc-inlay-hints-layer");
		this._domNode.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:10;";
		host.getContainer().appendChild(this._domNode);
	}

	public registerProvider(provider: IInlayHintsProvider): void {
		this._providers.push(provider);
	}

	public unregisterProvider(provider: IInlayHintsProvider): void {
		const index = this._providers.indexOf(provider);
		if (index !== -1) {
			this._providers.splice(index, 1);
		}
	}

	public setModel(model: ITextModel | null): void {
		this._model = model;
		this.refresh();
	}

	public async refresh(): Promise<void> {
		const model = this._model;
		clearNode(this._domNode);
		this._hints = [];
		if (!model || this._providers.length === 0) {
			this._onDidChange.fire();
			return;
		}
		const range: IRange = {
			startLineNumber: 1,
			startColumn: 1,
			endLineNumber: model.getLineCount(),
			endColumn: Number.MAX_SAFE_INTEGER
		};
		const results = await Promise.all(this._providers.map(async provider => {
			try {
				return await provider.provideInlayHints(model, range, CancellationToken.None);
			} catch {
				return [];
			}
		}));
		this._hints = results.flat().sort((a, b) => {
			if (a.position.lineNumber !== b.position.lineNumber) {
				return a.position.lineNumber - b.position.lineNumber;
			}
			return a.position.column - b.position.column;
		});
		this._render();
		this._onDidChange.fire();
	}

	private _render(): void {
		clearNode(this._domNode);
		for (const hint of this._hints) {
			const anchor = this._host.getCoordinates(hint.position.lineNumber, hint.position.column);
			if (!anchor) {
				continue;
			}
			const el = $<HTMLElement>("span", "dc-inlay-hint");
			el.textContent = hint.text;
			el.style.cssText = `position:absolute;left:${anchor.x}px;top:${anchor.y}px;font-size:12px;opacity:0.85;white-space:pre;${hint.kind === InlayHintKind.Parameter ? "color:#9cdcfe;" : "color:#6a9955;"}`;
			if (hint.paddingLeft) {
				el.style.marginLeft = "4px";
			}
			if (hint.paddingRight) {
				el.style.marginRight = "4px";
			}
			el.setAttribute("data-line", String(hint.position.lineNumber));
			this._domNode.appendChild(el);
		}
	}

	public layout(): void {
		this._render();
	}

	public getHints(): readonly IInlayHint[] {
		return this._hints;
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
