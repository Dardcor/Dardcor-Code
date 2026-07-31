import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostNotebookRenderer {
	private readonly _renderers = new Map<string, any>();
	
	registerNotebookRenderer(id: string): any {
		const renderer = {
			id,
			onDidReceiveMessage: new Emitter<any>().event,
			postMessage: (message: any) => Promise.resolve(true),
			dispose: () => this._renderers.delete(id)
		};
		this._renderers.set(id, renderer);
		return renderer;
	}
}
