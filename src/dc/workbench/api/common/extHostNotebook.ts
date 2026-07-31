import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostNotebook {
	private readonly _notebooks = new Map<string, any>();

	private readonly _onDidOpenNotebookDocument = new Emitter<any>();
	readonly onDidOpenNotebookDocument = this._onDidOpenNotebookDocument.event;

	private readonly _onDidCloseNotebookDocument = new Emitter<any>();
	readonly onDidCloseNotebookDocument = this._onDidCloseNotebookDocument.event;

	private readonly _onDidSaveNotebookDocument = new Emitter<any>();
	readonly onDidSaveNotebookDocument = this._onDidSaveNotebookDocument.event;

	get notebookDocuments(): any[] {
		return Array.from(this._notebooks.values());
	}

	createNotebookController(id: string, notebookType: string, label: string, handler?: any, preloads?: any[]): any {
		return {
			id,
			notebookType,
			label,
			supportedLanguages: [],
			detail: '',
			description: '',
			executeHandler: handler,
			interruptHandler: undefined,
			dispose: () => {}
		};
	}

	registerNotebookSerializer(notebookType: string, serializer: any, options?: any): IDisposable {
		return { dispose: () => {} };
	}

	$acceptModelAdd(data: any): void {
		this._notebooks.set(data.uri.toString(), data);
		this._onDidOpenNotebookDocument.fire(data);
	}

	$acceptModelRemoved(uri: any): void {
		const doc = this._notebooks.get(uri.toString());
		if (doc) {
			this._notebooks.delete(uri.toString());
			this._onDidCloseNotebookDocument.fire(doc);
		}
	}
}
