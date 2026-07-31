import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostExtension {
	private readonly _extensions = new Map<string, any>();

	getExtension(extensionId: string): any | undefined {
		return this._extensions.get(extensionId);
	}

	get all(): any[] {
		return Array.from(this._extensions.values());
	}

	readonly onDidChange = new Emitter<void>().event;

	$acceptExtensions(extensions: any[]): void {
		this._extensions.clear();
		for (const ext of extensions) {
			this._extensions.set(ext.id, ext);
		}
	}
}
