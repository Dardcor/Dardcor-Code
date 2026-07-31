import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerCodeLens {
	readonly range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
	readonly command?: { id: string; title: string; arguments?: any[] };
}

export interface IServerCodeLensProvider {
	readonly id: string;
	readonly onDidChange?: Event<this>;
	provideCodeLenses(uri: string): Promise<IServerCodeLens[] | undefined>;
	resolveCodeLens?(codeLens: IServerCodeLens): Promise<IServerCodeLens>;
}

export interface IServerCodeLensService {
	readonly onDidChangeCodeLenses: Event<void>;
	registerCodeLensProvider(provider: IServerCodeLensProvider): IDisposable;
	getCodeLenses(uri: string): Promise<IServerCodeLens[]>;
	resolveCodeLens(codeLens: IServerCodeLens): Promise<IServerCodeLens>;
}

export class ServerCodeLensCommon implements IServerCodeLensService {
	private readonly _providers = new Map<string, IServerCodeLensProvider>();

	private readonly _onDidChangeCodeLenses = new Emitter<void>();
	readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

	registerCodeLensProvider(provider: IServerCodeLensProvider): IDisposable {
		this._providers.set(provider.id, provider);
		const listeners: IDisposable[] = [];
		if (provider.onDidChange) {
			listeners.push(provider.onDidChange(() => this._onDidChangeCodeLenses.fire()));
		}
		this._onDidChangeCodeLenses.fire();
		return {
			dispose: () => {
				this._providers.delete(provider.id);
				listeners.forEach(l => l.dispose());
				this._onDidChangeCodeLenses.fire();
			}
		};
	}

	async getCodeLenses(uri: string): Promise<IServerCodeLens[]> {
		const lenses: IServerCodeLens[] = [];
		for (const provider of this._providers.values()) {
			const result = await provider.provideCodeLenses(uri);
			if (result) {
				lenses.push(...result);
			}
		}
		return lenses;
	}

	async resolveCodeLens(codeLens: IServerCodeLens): Promise<IServerCodeLens> {
		for (const provider of this._providers.values()) {
			if (provider.resolveCodeLens) {
				try {
					const resolved = await provider.resolveCodeLens(codeLens);
					if (resolved) return resolved;
				} catch {
					// Ignore errors
				}
			}
		}
		return codeLens;
	}
}
