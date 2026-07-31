/**
 * Dardcor Code - CodeLens Provider Registry Interface
 */

import { Disposable, IDisposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { toDisposable } from "../../../core/lifecycle/disposable.js";
import { CancellationToken } from "../../../core/async/cancellation.js";
import { ITextModel } from "../../model/text-model.js";
import { ICodeLens, ICodeLensProvider } from "./codelens-controller.js";

export class CodeLensProviderRegistry extends Disposable {
	private readonly _providers: ICodeLensProvider[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	public register(provider: ICodeLensProvider): IDisposable {
		this._providers.push(provider);
		this._onDidChange.fire();
		return toDisposable(() => this.unregister(provider));
	}

	public unregister(provider: ICodeLensProvider): void {
		const index = this._providers.indexOf(provider);
		if (index !== -1) {
			this._providers.splice(index, 1);
			this._onDidChange.fire();
		}
	}

	public getProviders(): readonly ICodeLensProvider[] {
		return this._providers;
	}

	public getProviderCount(): number {
		return this._providers.length;
	}

	public async provideCodeLenses(model: ITextModel): Promise<ICodeLens[]> {
		const results = await Promise.all(this._providers.map(async provider => {
			try {
				return await provider.provideCodeLenses(model, CancellationToken.None);
			} catch {
				return [];
			}
		}));
		return results.flat().sort((a, b) => {
			if (a.range.startLineNumber !== b.range.startLineNumber) {
				return a.range.startLineNumber - b.range.startLineNumber;
			}
			return a.range.startColumn - b.range.startColumn;
		});
	}

	public async resolveCodeLens(model: ITextModel, lens: ICodeLens): Promise<ICodeLens> {
		for (const provider of this._providers) {
			const resolve = provider.resolveCodeLens;
			if (resolve) {
				try {
					const resolved = await resolve.call(provider, model, lens, CancellationToken.None);
					if (resolved) {
						return resolved;
					}
				} catch {
					// Try the next provider
				}
			}
		}
		return lens;
	}
}

export type { ICodeLens, ICodeLensProvider } from "./codelens-controller.js";
