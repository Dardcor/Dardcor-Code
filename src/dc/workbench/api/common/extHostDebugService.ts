import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostDebugService {
	private readonly _debugConfigurations = new Map<string, any>();

	registerDebugConfigurationProvider(debugType: string, provider: any): IDisposable {
		this._debugConfigurations.set(debugType, provider);
		return { dispose: () => this._debugConfigurations.delete(debugType) };
	}

	resolveDebugConfiguration(folder: any, debugConfiguration: any, token?: any): Promise<any> {
		return Promise.resolve(debugConfiguration);
	}
}
