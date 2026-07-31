import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerSignatureParameter {
	readonly label: string | [number, number];
	readonly documentation?: string;
}

export interface IServerSignatureInformation {
	readonly label: string;
	readonly documentation?: string;
	readonly parameters: IServerSignatureParameter[];
	readonly activeParameter?: number;
}

export interface IServerSignatureHelp {
	readonly signatures: IServerSignatureInformation[];
	readonly activeSignature: number;
	readonly activeParameter: number;
}

export interface IServerSignatureHelpProvider {
	readonly id: string;
	readonly triggerCharacters?: string[];
	provideSignatureHelp(uri: string, position: { line: number; column: number }, context: any): Promise<IServerSignatureHelp | undefined>;
}

export interface IServerSignatureHelpService {
	readonly onDidRegisterProvider: Event<IServerSignatureHelpProvider>;
	registerSignatureHelpProvider(provider: IServerSignatureHelpProvider): IDisposable;
	provideSignatureHelp(uri: string, position: { line: number; column: number }, context: any): Promise<IServerSignatureHelp | undefined>;
}

export class ServerSignatureHelpCommon implements IServerSignatureHelpService {
	private readonly _providers = new Map<string, IServerSignatureHelpProvider>();

	private readonly _onDidRegisterProvider = new Emitter<IServerSignatureHelpProvider>();
	readonly onDidRegisterProvider = this._onDidRegisterProvider.event;

	registerSignatureHelpProvider(provider: IServerSignatureHelpProvider): IDisposable {
		this._providers.set(provider.id, provider);
		this._onDidRegisterProvider.fire(provider);
		return { dispose: () => { this._providers.delete(provider.id); } };
	}

	async provideSignatureHelp(uri: string, position: { line: number; column: number }, context: any): Promise<IServerSignatureHelp | undefined> {
		for (const provider of this._providers.values()) {
			const result = await provider.provideSignatureHelp(uri, position, context);
			if (result) {
				return result;
			}
		}
		return undefined;
	}
}
