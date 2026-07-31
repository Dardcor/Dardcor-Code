import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostAuthentication {
	private readonly _providers = new Map<string, any>();

	private readonly _onDidChangeSessions = new Emitter<any>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	getSession(providerId: string, scopes: string[], options?: any): Promise<any | undefined> {
		const provider = this._providers.get(providerId);
		if (provider) {
			return provider.getSessions(scopes).then((sessions: any[]) => sessions[0]);
		}
		return Promise.resolve(undefined);
	}

	registerAuthenticationProvider(id: string, label: string, provider: any, options?: any): IDisposable {
		this._providers.set(id, provider);
		
		if (provider.onDidChangeSessions) {
			provider.onDidChangeSessions((e: any) => this._onDidChangeSessions.fire(e));
		}

		return {
			dispose: () => {
				this._providers.delete(id);
			}
		};
	}
}
