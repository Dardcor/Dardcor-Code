/**
 * Dardcor Code - Inlay Hint Provider Registry Interface
 */

import { Disposable, IDisposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { toDisposable } from "../../../core/lifecycle/disposable.js";
import { CancellationToken } from "../../../core/async/cancellation.js";
import { ITextModel, IRange } from "../../model/text-model.js";
import { IInlayHint, IInlayHintsProvider } from "./inlay-hints-controller.js";

export class InlayHintsProviderRegistry extends Disposable {
	private readonly _providers: IInlayHintsProvider[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	public register(provider: IInlayHintsProvider): IDisposable {
		this._providers.push(provider);
		this._onDidChange.fire();
		return toDisposable(() => this.unregister(provider));
	}

	public unregister(provider: IInlayHintsProvider): void {
		const index = this._providers.indexOf(provider);
		if (index !== -1) {
			this._providers.splice(index, 1);
			this._onDidChange.fire();
		}
	}

	public getProviders(): readonly IInlayHintsProvider[] {
		return this._providers;
	}

	public getProviderCount(): number {
		return this._providers.length;
	}

	public async provideInlayHints(model: ITextModel, range: IRange): Promise<IInlayHint[]> {
		const results = await Promise.all(this._providers.map(async provider => {
			try {
				return await provider.provideInlayHints(model, range, CancellationToken.None);
			} catch {
				return [];
			}
		}));
		return results.flat().sort((a, b) => {
			if (a.position.lineNumber !== b.position.lineNumber) {
				return a.position.lineNumber - b.position.lineNumber;
			}
			return a.position.column - b.position.column;
		});
	}
}

export type { IInlayHintsProvider, IInlayHint } from "./inlay-hints-controller.js";
