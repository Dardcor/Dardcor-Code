import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostDebugAdapter {
	private readonly _adapters = new Map<string, any>();

	registerDebugAdapterDescriptorFactory(debugType: string, factory: any): IDisposable {
		this._adapters.set(debugType, factory);
		return { dispose: () => this._adapters.delete(debugType) };
	}

	registerDebugAdapterTrackerFactory(debugType: string, factory: any): IDisposable {
		// Mock tracker
		return { dispose: () => {} };
	}
}
