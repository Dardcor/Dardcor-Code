/**
 * Dardcor Code - Webview Service (Task 154)
 * Mirrors: vs/workbench/contrib/webview/common/webview.ts (webview panel pool manager)
 */

import { createDecorator } from '../instantiation/annotations.js';
import { Disposable, IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface IWebview extends IDisposable {
	html: string;
	readonly onDidReceiveMessage: Event<any>;
	postMessage(message: any): Promise<boolean>;
	mountTo(container: HTMLElement): void;
}

export interface IWebviewOptions {
	enableScripts?: boolean;
}

export const IWebviewService = createDecorator<IWebviewService>('webviewService');

export interface IWebviewService {
	readonly _serviceBrand: undefined;
	createWebviewElement(options?: IWebviewOptions): IWebview;
}

export class WebviewService implements IWebviewService {
	declare readonly _serviceBrand: undefined;

	private readonly _panels: IWebview[] = [];
	private readonly _onDidDisposeWebview = new Emitter<IWebview>();

	createWebviewElement(options?: IWebviewOptions): IWebview {
		let html = '';
		let iframe: HTMLIFrameElement | null = null;
		const onDidReceiveMessage = new Emitter<any>();

		const webview: IWebview = {
			get html() {
				return html;
			},
			set html(value: string) {
				html = value;
				if (iframe) {
					iframe.srcdoc = value;
				}
			},
			onDidReceiveMessage: onDidReceiveMessage.event,
			postMessage: async (message: any) => {
				iframe?.contentWindow?.postMessage(message, '*');
				return true;
			},
			mountTo: (container: HTMLElement) => {
				iframe = document.createElement('iframe');
				iframe.className = 'dc-webview-frame';
				iframe.style.border = 'none';
				iframe.style.width = '100%';
				iframe.style.height = '100%';
				if (options?.enableScripts) {
					iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals');
				} else {
					iframe.setAttribute('sandbox', 'allow-same-origin');
				}
				iframe.srcdoc = html;
				container.appendChild(iframe);

				const listener = (e: MessageEvent) => {
					if (e.source === iframe?.contentWindow) {
						onDidReceiveMessage.fire(e.data);
					}
				};
				window.addEventListener('message', listener);

				webview.dispose = () => {
					window.removeEventListener('message', listener);
					iframe?.remove();
					iframe = null;
					onDidReceiveMessage.dispose();
					const idx = this._panels.indexOf(webview);
					if (idx >= 0) {
						this._panels.splice(idx, 1);
					}
					this._onDidDisposeWebview.fire(webview);
				};
			},
			dispose: () => {
				// dispose() is wired up inside mountTo (requires the iframe).
			},
		};

		this._panels.push(webview);
		return webview;
	}
}
