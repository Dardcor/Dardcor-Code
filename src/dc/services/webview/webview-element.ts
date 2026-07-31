/**
 * Dardcor Code - Webview DOM Element Component (Task 199)
 * Mirrors: vs/workbench/contrib/webview/browser/webviewElement.ts
 */

import { IDisposable } from '../../core/lifecycle/disposable.js';

export class WebviewElementComponent implements IDisposable {
	private readonly _iframe: HTMLIFrameElement;

	constructor(container: HTMLElement, enableScripts = true) {
		this._iframe = document.createElement('iframe');
		this._iframe.className = 'dc-webview-element';
		this._iframe.style.width = '100%';
		this._iframe.style.height = '100%';
		this._iframe.style.border = 'none';
		this._iframe.setAttribute('sandbox', enableScripts ? 'allow-scripts allow-same-origin allow-forms' : 'allow-same-origin');
		container.appendChild(this._iframe);
	}

	setHTML(html: string): void {
		this._iframe.srcdoc = html;
	}

	postMessage(msg: any): void {
		this._iframe.contentWindow?.postMessage(msg, '*');
	}

	dispose(): void {
		this._iframe.remove();
	}
}
