import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IExtensionHostInitData {
	readonly extensions: any[];
	readonly environment: any;
	readonly workspace: any;
	readonly logsLocation: string;
	readonly logLevel: number;
}

export interface IExtensionHostMain {
	terminate(): void;
}

export class ExtensionHostMain implements IExtensionHostMain {
	private _terminated = false;

	constructor(initData: IExtensionHostInitData) {
		console.log('ExtensionHostMain initialized with:', initData.environment);
		this.init(initData);
	}

	private async init(initData: IExtensionHostInitData): Promise<void> {
		// Initialize the extension host environment
		console.log('Starting extension host...');
		// Load extensions
	}

	terminate(): void {
		if (this._terminated) {
			return;
		}
		this._terminated = true;
		console.log('ExtensionHostMain terminated.');
	}
}

export function createExtensionHostMain(initData: IExtensionHostInitData): IExtensionHostMain {
	return new ExtensionHostMain(initData);
}
