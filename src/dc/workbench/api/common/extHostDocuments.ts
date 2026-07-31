import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostDocuments {
	private readonly _documents = new Map<string, any>();

	private readonly _onDidOpenTextDocument = new Emitter<any>();
	readonly onDidOpenTextDocument = this._onDidOpenTextDocument.event;

	private readonly _onDidCloseTextDocument = new Emitter<any>();
	readonly onDidCloseTextDocument = this._onDidCloseTextDocument.event;

	private readonly _onDidChangeTextDocument = new Emitter<any>();
	readonly onDidChangeTextDocument = this._onDidChangeTextDocument.event;

	private readonly _onDidSaveTextDocument = new Emitter<any>();
	readonly onDidSaveTextDocument = this._onDidSaveTextDocument.event;

	getDocument(uri: string): any | undefined {
		return this._documents.get(uri);
	}

	getAllDocuments(): any[] {
		return Array.from(this._documents.values());
	}

	$acceptModelAdd(data: any): void {
		this._documents.set(data.uri, data);
		this._onDidOpenTextDocument.fire(data);
	}

	$acceptModelRemoved(uri: string): void {
		const doc = this._documents.get(uri);
		if (doc) {
			this._documents.delete(uri);
			this._onDidCloseTextDocument.fire(doc);
		}
	}
}
