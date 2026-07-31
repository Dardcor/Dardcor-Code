import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostWebviews {
	private readonly _webviews = new Map<string, any>();

	createWebviewPanel(viewType: string, title: string, showOptions: any, options?: any): any {
		const id = `webview-${Math.random().toString(36).substr(2, 9)}`;
		
		const webview = {
			options: options || {},
			html: '',
			onDidReceiveMessage: new Emitter<any>().event,
			postMessage: (message: any) => Promise.resolve(true),
			asWebviewUri: (localResource: any) => localResource
		};

		const panel = {
			viewType,
			title,
			webview,
			options: options || {},
			viewColumn: typeof showOptions === 'number' ? showOptions : showOptions.viewColumn,
			active: true,
			visible: true,
			onDidChangeViewState: new Emitter<any>().event,
			onDidDispose: new Emitter<void>().event,
			reveal: (viewColumn?: number, preserveFocus?: boolean) => {},
			dispose: () => {
				this._webviews.delete(id);
			}
		};

		this._webviews.set(id, panel);
		return panel;
	}

	registerWebviewPanelSerializer(viewType: string, serializer: any): IDisposable {
		return { dispose: () => {} };
	}
}
