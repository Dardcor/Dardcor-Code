/**
 * Dardcor Code - Webview iframe DOM Component (Task 199)
 * Mirrors: vs/workbench/contrib/webview/browser/webviewElement.ts
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface IWebviewElementOptions {
	readonly enableScripts?: boolean;
	readonly enableForms?: boolean;
	readonly allowSameOrigin?: boolean;
	readonly allowModalDialogs?: boolean;
}

export class WebviewElement extends Disposable {
	private readonly _iframe: HTMLIFrameElement;

	private readonly _onDidReceiveMessage = this._register(new Emitter<any>());
	readonly onDidReceiveMessage: Event<any> = this._onDidReceiveMessage.event;

	private readonly _onDidLoad = this._register(new Emitter<void>());
	readonly onDidLoad: Event<void> = this._onDidLoad.event;

	constructor(container: HTMLElement, options: IWebviewElementOptions = {}) {
		super();
		this._iframe = document.createElement('iframe');
		this._iframe.className = 'dc-webview-element';
		this._iframe.style.width = '100%';
		this._iframe.style.height = '100%';
		this._iframe.style.border = 'none';
		this._iframe.style.background = 'transparent';

		const sandbox: string[] = [];
		if (options.enableScripts !== false) sandbox.push('allow-scripts');
		if (options.allowSameOrigin) sandbox.push('allow-same-origin');
		if (options.enableForms) sandbox.push('allow-forms');
		if (options.allowModalDialogs) sandbox.push('allow-modals');
		this._iframe.setAttribute('sandbox', sandbox.join(' '));
		this._iframe.setAttribute('allow', 'clipboard-read; clipboard-write');

		this._register(this._listen());
		container.appendChild(this._iframe);
	}

	setHTML(html: string): void {
		this._iframe.srcdoc = html;
	}

	setSrc(url: string): void {
		this._iframe.src = url;
	}

	postMessage(msg: any): void {
		this._iframe.contentWindow?.postMessage(msg, '*');
	}

	focus(): void {
		this._iframe.contentWindow?.focus();
	}

	dispose(): void {
		this._iframe.remove();
		super.dispose();
	}

	private _listen(): { dispose(): void } {
		const onMessage = (event: MessageEvent) => {
			if (event.source === this._iframe.contentWindow) {
				this._onDidReceiveMessage.fire(event.data);
			}
		};
		const onLoad = () => this._onDidLoad.fire();
		globalThis.addEventListener('message', onMessage);
		this._iframe.addEventListener('load', onLoad);
		return {
			dispose: () => {
				globalThis.removeEventListener('message', onMessage);
				this._iframe.removeEventListener('load', onLoad);
			},
		};
	}
}
