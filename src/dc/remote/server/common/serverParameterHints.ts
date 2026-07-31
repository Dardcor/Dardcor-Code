import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';
import { IServerSignatureHelpProvider, IServerSignatureHelp, ServerSignatureHelpCommon } from './serverSignatureHelp.js';

export interface IServerParameterHintsProvider extends IServerSignatureHelpProvider {}
export interface IServerParameterHints extends IServerSignatureHelp {}

export interface IServerParameterHintsService {
	readonly onDidRegisterProvider: Event<IServerParameterHintsProvider>;
	registerParameterHintsProvider(provider: IServerParameterHintsProvider): IDisposable;
	provideParameterHints(uri: string, position: { line: number; column: number }, context: any): Promise<IServerParameterHints | undefined>;
}

export class ServerParameterHintsCommon extends ServerSignatureHelpCommon implements IServerParameterHintsService {
	registerParameterHintsProvider(provider: IServerParameterHintsProvider): IDisposable {
		return this.registerSignatureHelpProvider(provider);
	}

	async provideParameterHints(uri: string, position: { line: number; column: number }, context: any): Promise<IServerParameterHints | undefined> {
		return this.provideSignatureHelp(uri, position, context);
	}
}
