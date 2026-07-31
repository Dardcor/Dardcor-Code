import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IExtensionHostProcessOptions {
	readonly execArgv?: string[];
	readonly env?: NodeJS.ProcessEnv;
}

export interface IExtensionHostProcess {
	readonly onDidExit: Event<{ code: number; signal: string }>;
	start(options?: IExtensionHostProcessOptions): Promise<void>;
	terminate(): void;
}

export class ExtensionHostProcess implements IExtensionHostProcess {
	private readonly _onDidExit = new Emitter<{ code: number; signal: string }>();
	readonly onDidExit = this._onDidExit.event;

	async start(options?: IExtensionHostProcessOptions): Promise<void> {
		console.log('Starting Extension Host Process with options:', options);
		// Mock start
	}

	terminate(): void {
		console.log('Terminating Extension Host Process');
		this._onDidExit.fire({ code: 0, signal: 'SIGTERM' });
	}
}
