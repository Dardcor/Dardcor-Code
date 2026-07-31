import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostExtensions {
	private readonly _extensions = new Map<string, any>();

	getExtension(extensionId: string): any {
		return this._extensions.get(extensionId);
	}

	get all(): any[] {
		return Array.from(this._extensions.values());
	}

	readonly onDidChange = new Emitter<void>().event;
}
