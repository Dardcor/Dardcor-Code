import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerCodeAction {
	readonly title: string;
	readonly edit?: any;
	readonly command?: any;
	readonly kind?: string;
	readonly isPreferred?: boolean;
}

export interface IServerCodeActionProvider {
	readonly id: string;
	readonly providedCodeActionKinds?: string[];
	provideCodeActions(uri: string, range: any, context: any): Promise<IServerCodeAction[] | undefined>;
	resolveCodeAction?(codeAction: IServerCodeAction): Promise<IServerCodeAction>;
}

export interface IServerCodeActionService {
	readonly onDidRegisterProvider: Event<IServerCodeActionProvider>;
	registerCodeActionProvider(provider: IServerCodeActionProvider): IDisposable;
	getCodeActions(uri: string, range: any, context: any): Promise<IServerCodeAction[]>;
	resolveCodeAction(codeAction: IServerCodeAction): Promise<IServerCodeAction>;
}

export class ServerCodeActionCommon implements IServerCodeActionService {
	private readonly _providers = new Map<string, IServerCodeActionProvider>();

	private readonly _onDidRegisterProvider = new Emitter<IServerCodeActionProvider>();
	readonly onDidRegisterProvider = this._onDidRegisterProvider.event;

	registerCodeActionProvider(provider: IServerCodeActionProvider): IDisposable {
		this._providers.set(provider.id, provider);
		this._onDidRegisterProvider.fire(provider);
		return { dispose: () => { this._providers.delete(provider.id); } };
	}

	async getCodeActions(uri: string, range: any, context: any): Promise<IServerCodeAction[]> {
		const actions: IServerCodeAction[] = [];
		for (const provider of this._providers.values()) {
			const result = await provider.provideCodeActions(uri, range, context);
			if (result) {
				actions.push(...result);
			}
		}
		return actions;
	}

	async resolveCodeAction(codeAction: IServerCodeAction): Promise<IServerCodeAction> {
		for (const provider of this._providers.values()) {
			if (provider.resolveCodeAction) {
				// Naive approach: trying all providers to resolve
				try {
					const resolved = await provider.resolveCodeAction(codeAction);
					if (resolved) return resolved;
				} catch {
					// Ignore errors during resolution
				}
			}
		}
		return codeAction;
	}
}
