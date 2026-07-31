/**
 * Dardcor Code - Signature Help Provider Registry
 */

import { Disposable, IDisposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { toDisposable } from "../../../core/lifecycle/disposable.js";
import { CancellationToken } from "../../../core/async/cancellation.js";
import { ITextModel, IPosition } from "../../model/text-model.js";
import { ISignatureHelp, ISignatureInformation } from "./parameter-hints-model.js";

export type SignatureHelpTriggerKind = "invoke" | "triggerCharacter" | "contentChange";

export interface ISignatureHelpContext {
	readonly triggerKind: SignatureHelpTriggerKind;
	readonly triggerCharacter?: string;
	readonly isRetrigger: boolean;
	readonly activeSignatureHelp?: ISignatureHelp;
}

export interface ISignatureHelpProvider {
	provideSignatureHelp(
		model: ITextModel,
		position: IPosition,
		context: ISignatureHelpContext,
		token: CancellationToken
	): ISignatureHelp | null | Promise<ISignatureHelp | null>;
}

export class SignatureHelpProviderRegistry extends Disposable {
	private readonly _providers: ISignatureHelpProvider[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	public register(provider: ISignatureHelpProvider): IDisposable {
		this._providers.push(provider);
		this._onDidChange.fire();
		return toDisposable(() => this.unregister(provider));
	}

	public unregister(provider: ISignatureHelpProvider): void {
		const index = this._providers.indexOf(provider);
		if (index !== -1) {
			this._providers.splice(index, 1);
			this._onDidChange.fire();
		}
	}

	public getProviders(): readonly ISignatureHelpProvider[] {
		return this._providers;
	}

	public async provideSignatureHelp(model: ITextModel, position: IPosition, context: ISignatureHelpContext): Promise<ISignatureHelp | null> {
		for (const provider of this._providers) {
			try {
				const result = await provider.provideSignatureHelp(model, position, context, CancellationToken.None);
				if (result && result.signatures.length > 0) {
					return result;
				}
			} catch {
				// Try the next provider
			}
		}
		return null;
	}
}

export type { ISignatureHelp, ISignatureInformation } from "./parameter-hints-model.js";
