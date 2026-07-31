/**
 * Dardcor Code - Inline Completion Provider Registry
 */

import { Disposable, IDisposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { toDisposable } from "../../../core/lifecycle/disposable.js";
import { CancellationToken } from "../../../core/async/cancellation.js";
import { ITextModel, IPosition } from "../../model/text-model.js";
import { IInlineCompletion, IInlineCompletionContext, IInlineCompletionProvider } from "./inline-completions-controller.js";

export class InlineCompletionsProviderRegistry extends Disposable {
	private readonly _providers: IInlineCompletionProvider[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	public register(provider: IInlineCompletionProvider): IDisposable {
		this._providers.push(provider);
		this._onDidChange.fire();
		return toDisposable(() => this.unregister(provider));
	}

	public unregister(provider: IInlineCompletionProvider): void {
		const index = this._providers.indexOf(provider);
		if (index !== -1) {
			this._providers.splice(index, 1);
			this._onDidChange.fire();
		}
	}

	public getProviders(): readonly IInlineCompletionProvider[] {
		return this._providers;
	}

	public getProviderCount(): number {
		return this._providers.length;
	}

	public async provideInlineCompletions(model: ITextModel, position: IPosition, context: IInlineCompletionContext): Promise<IInlineCompletion[]> {
		for (const provider of this._providers) {
			try {
				const completions = await provider.provideInlineCompletions(model, position, context, CancellationToken.None);
				if (completions && completions.length > 0) {
					return completions;
				}
			} catch {
				// Try the next provider
			}
		}
		return [];
	}

	public async provideFirst(model: ITextModel, position: IPosition, context: IInlineCompletionContext): Promise<IInlineCompletion | null> {
		const completions = await this.provideInlineCompletions(model, position, context);
		return completions.length > 0 ? completions[0] : null;
	}
}

export type { IInlineCompletionProvider, IInlineCompletion, IInlineCompletionContext } from "./inline-completions-controller.js";
