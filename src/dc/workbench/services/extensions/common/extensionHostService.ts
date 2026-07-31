import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IExtensionHostService {
	readonly onDidRegisterExtensions: Event<void>;
	readonly onDidChangeExtensions: Event<void>;
	readonly onDidChangeProfile: Event<void>;
	
	activateByEvent(activationEvent: string): Promise<void>;
	whenInstalledExtensionsRegistered(): Promise<boolean>;
	getExtension(id: string): Promise<any | undefined>;
	getExtensions(): Promise<any[]>;
}

export class ExtensionHostService implements IExtensionHostService {
	private readonly _onDidRegisterExtensions = new Emitter<void>();
	readonly onDidRegisterExtensions = this._onDidRegisterExtensions.event;

	private readonly _onDidChangeExtensions = new Emitter<void>();
	readonly onDidChangeExtensions = this._onDidChangeExtensions.event;

	private readonly _onDidChangeProfile = new Emitter<void>();
	readonly onDidChangeProfile = this._onDidChangeProfile.event;

	async activateByEvent(activationEvent: string): Promise<void> {
		console.log('Activating by event:', activationEvent);
	}

	async whenInstalledExtensionsRegistered(): Promise<boolean> {
		return true;
	}

	async getExtension(id: string): Promise<any | undefined> {
		return undefined;
	}

	async getExtensions(): Promise<any[]> {
		return [];
	}
}
