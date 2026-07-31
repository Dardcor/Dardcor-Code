/**
 * Dardcor Code - Hover Info Provider Aggregator Operation
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { CancellationTokenSource, CancellationToken } from "../../../core/async/cancellation.js";
import { ITextModel, IPosition, IRange } from "../../model/text-model.js";
import { HoverWidget, IHoverAnchor } from "./hover-widget.js";
import { MarkedString, MarkdownHover } from "./markdown-hover.js";

export interface IHover {
	readonly contents: MarkedString[];
	readonly range?: IRange;
}

export interface IHoverProvider {
	provideHover(model: ITextModel, position: IPosition, token: CancellationToken): IHover | null | Promise<IHover | null>;
}

export enum HoverStartMode {
	Delayed = 0,
	Immediate = 1
}

export class HoverOperation extends Disposable {
	private readonly _providers: IHoverProvider[] = [];
	private readonly _widget: HoverWidget;
	private _model: ITextModel | null = null;
	private _position: IPosition | null = null;
	private _cts: CancellationTokenSource | null = null;
	private _delayTimer: any = null;
	private _isComputing: boolean = false;
	private _lastRequest: number = 0;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(widget: HoverWidget) {
		super();
		this._widget = widget;
	}

	public registerProvider(provider: IHoverProvider): void {
		this._providers.push(provider);
	}

	public unregisterProvider(provider: IHoverProvider): void {
		const index = this._providers.indexOf(provider);
		if (index !== -1) {
			this._providers.splice(index, 1);
		}
	}

	public getProviders(): readonly IHoverProvider[] {
		return this._providers;
	}

	public start(model: ITextModel, position: IPosition, anchor: IHoverAnchor, mode: HoverStartMode = HoverStartMode.Delayed): void {
		this._model = model;
		this._position = position;
		this._widget.cancelHide();
		if (mode === HoverStartMode.Immediate) {
			this._compute(anchor);
			return;
		}
		if (this._delayTimer) {
			clearTimeout(this._delayTimer);
		}
		this._delayTimer = setTimeout(() => {
			this._delayTimer = null;
			this._compute(anchor);
		}, 250);
	}

	public cancel(): void {
		if (this._delayTimer) {
			clearTimeout(this._delayTimer);
			this._delayTimer = null;
		}
		this._cts?.cancel();
		this._cts = null;
		this._lastRequest++;
	}

	public hide(): void {
		this.cancel();
		this._widget.hide();
	}

	private async _compute(anchor: IHoverAnchor): Promise<void> {
		const model = this._model;
		const position = this._position;
		if (!model || !position || this._providers.length === 0) {
			return;
		}
		if (this._isComputing) {
			return;
		}
		this._isComputing = true;
		const request = ++this._lastRequest;
		this._cts?.cancel();
		this._cts = new CancellationTokenSource();
		const token = this._cts.token;

		try {
			const results = await Promise.all(this._providers.map(async provider => {
				try {
					return await provider.provideHover(model, position, token);
				} catch {
					return null;
				}
			}));
			if (request !== this._lastRequest || token.isCancellationRequested) {
				return;
			}
			const contents: MarkedString[] = [];
			for (const result of results) {
				if (result && result.contents.length > 0) {
					contents.push(...result.contents);
				}
			}
			if (contents.length === 0) {
				this._widget.hide();
				return;
			}
			const container = document.createElement("div");
			for (const content of contents) {
				container.appendChild(MarkdownHover.renderToDom(content));
			}
			this._widget.show(container, anchor);
			this._onDidChange.fire();
		} finally {
			this._isComputing = false;
		}
	}

	public override dispose(): void {
		this.cancel();
		super.dispose();
	}
}
