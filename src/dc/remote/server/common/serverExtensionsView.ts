import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerExtensionViewEntry {
	readonly id: string;
	readonly name: string;
	readonly version: string;
	readonly description?: string;
	readonly isBuiltin: boolean;
	readonly isActive: boolean;
}

export interface IServerExtensionsViewService {
	readonly onDidChangeExtensions: Event<void>;
	getExtensions(): IServerExtensionViewEntry[];
	getExtension(id: string): IServerExtensionViewEntry | undefined;
	installExtension(id: string): Promise<void>;
	uninstallExtension(id: string): Promise<void>;
	searchExtensions(query: string): Promise<IServerExtensionViewEntry[]>;
}

export class ServerExtensionsViewCommon implements IServerExtensionsViewService {
	private readonly _extensions = new Map<string, IServerExtensionViewEntry>();

	private readonly _onDidChangeExtensions = new Emitter<void>();
	readonly onDidChangeExtensions = this._onDidChangeExtensions.event;

	getExtensions(): IServerExtensionViewEntry[] {
		return Array.from(this._extensions.values());
	}

	getExtension(id: string): IServerExtensionViewEntry | undefined {
		return this._extensions.get(id);
	}

	async installExtension(id: string): Promise<void> {
		if (!this._extensions.has(id)) {
			this._extensions.set(id, { id, name: id, version: '1.0.0', isBuiltin: false, isActive: true });
			this._onDidChangeExtensions.fire();
		}
	}

	async uninstallExtension(id: string): Promise<void> {
		if (this._extensions.has(id)) {
			this._extensions.delete(id);
			this._onDidChangeExtensions.fire();
		}
	}

	async searchExtensions(query: string): Promise<IServerExtensionViewEntry[]> {
		const lower = query.toLowerCase();
		return this.getExtensions().filter(e => e.name.toLowerCase().includes(lower) || e.id.toLowerCase().includes(lower));
	}
}
