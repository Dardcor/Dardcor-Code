/**
 * Dardcor Code - Webview Service (Task 154)
 * Mirrors: vs/workbench/contrib/webview/common/webview.ts
 */

import { IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface IWebview extends IDisposable {
	html: string;
	readonly onDidReceiveMessage: Event<any>;
	postMessage(message: any): Promise<boolean>;
	mountTo(container: HTMLElement): void;
}

export const IWebviewService = Symbol('IWebviewService');

export interface IWebviewService {
	createWebviewElement(options?: { enableScripts?: boolean }): IWebview;
}

export class WebviewService implements IWebviewService {
	createWebviewElement(options?: { enableScripts?: boolean }): IWebview {
		let html = '';
		let iframe: HTMLIFrameElement | null = null;
		const onDidReceiveMessage = new Emitter<any>();

		const webview: IWebview = {
			get html() { return html; },
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

				window.addEventListener('message', (e) => {
					if (e.source === iframe?.contentWindow) {
						onDidReceiveMessage.fire(e.data);
					}
				});
			},
			dispose: () => {
				iframe?.remove();
				iframe = null;
				onDidReceiveMessage.dispose();
			}
		};

		return webview;
	}
}
