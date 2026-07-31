import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IExtensionHostDebugService {
	readonly onDidStartDebugSession: Event<string>;
	startDebugging(config: any): Promise<void>;
	stopDebugging(): void;
}

export class ExtensionHostDebugService implements IExtensionHostDebugService {
	private readonly _onDidStartDebugSession = new Emitter<string>();
	readonly onDidStartDebugSession = this._onDidStartDebugSession.event;

	async startDebugging(config: any): Promise<void> {
		console.log('Starting debug session with config:', config);
		this._onDidStartDebugSession.fire(config?.name || 'unknown');
	}

	stopDebugging(): void {
		console.log('Stopping debug session');
	}
}
