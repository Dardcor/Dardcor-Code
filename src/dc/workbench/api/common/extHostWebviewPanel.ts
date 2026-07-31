import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostWebviewPanel {
	private readonly _panels = new Map<string, any>();
	
	createWebviewPanel(viewType: string, title: string, showOptions: any, options?: any): any {
		const panel = {
			viewType,
			title,
			webview: {
				html: '',
				onDidReceiveMessage: new Emitter<any>().event,
				postMessage: (message: any) => Promise.resolve(true),
			},
			dispose: () => this._panels.delete(viewType)
		};
		this._panels.set(viewType, panel);
		return panel;
	}
}
