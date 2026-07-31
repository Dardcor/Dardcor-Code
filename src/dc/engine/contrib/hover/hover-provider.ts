/**
 * Dardcor Code - Hover Provider Registry Interface
 */

import { Disposable, IDisposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { toDisposable } from "../../../core/lifecycle/disposable.js";
import { CancellationToken } from "../../../core/async/cancellation.js";
import { ITextModel, IPosition } from "../../model/text-model.js";
import { IHover, IHoverProvider } from "./hover-operation.js";
import { MarkedString } from "./markdown-hover.js";

export class HoverProviderRegistry extends Disposable {
	private readonly _providers: IHoverProvider[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	public register(provider: IHoverProvider): IDisposable {
		this._providers.push(provider);
		this._onDidChange.fire();
		return toDisposable(() => this.unregister(provider));
	}

	public unregister(provider: IHoverProvider): void {
		const index = this._providers.indexOf(provider);
		if (index !== -1) {
			this._providers.splice(index, 1);
			this._onDidChange.fire();
		}
	}

	public getProviders(): readonly IHoverProvider[] {
		return this._providers;
	}

	public getProviderCount(): number {
		return this._providers.length;
	}

	public async provideHovers(model: ITextModel, position: IPosition, token: CancellationToken = CancellationToken.None): Promise<IHover[]> {
		const results: IHover[] = [];
		for (const provider of this._providers) {
			try {
				const hover = await provider.provideHover(model, position, token);
				if (hover && hover.contents.length > 0) {
					results.push(hover);
				}
			} catch {
				// A failing provider must not break the hover aggregation
			}
		}
		return results;
	}

	public async getContentsAt(model: ITextModel, position: IPosition): Promise<MarkedString[]> {
		const hovers = await this.provideHovers(model, position);
		const contents: MarkedString[] = [];
		for (const hover of hovers) {
			contents.push(...hover.contents);
		}
		return contents;
	}

	public async hasContentAt(model: ITextModel, position: IPosition): Promise<boolean> {
		const contents = await this.getContentsAt(model, position);
		return contents.length > 0;
	}
}
