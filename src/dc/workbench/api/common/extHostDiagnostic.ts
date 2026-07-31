import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostDiagnostic {
	private readonly _collections = new Map<string, any>();

	createDiagnosticCollection(name?: string): any {
		const collectionName = name || `collection-${Math.random()}`;
		const collection = {
			name: collectionName,
			set: (uri: any, diagnostics: any[] | undefined) => {},
			delete: (uri: any) => {},
			clear: () => {},
			forEach: (callback: any, thisArg?: any) => {},
			get: (uri: any) => [],
			has: (uri: any) => false,
			dispose: () => {
				this._collections.delete(collectionName);
			}
		};
		this._collections.set(collectionName, collection);
		return collection;
	}

	getDiagnostics(resource?: any): any[] {
		return [];
	}

	readonly onDidChangeDiagnostics = new Emitter<any>().event;
}
