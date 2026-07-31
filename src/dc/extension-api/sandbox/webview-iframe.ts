import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { buildWebviewCsp } from './webview-csp';

export interface IWebviewIframeOptions {
	allowScripts?: boolean;
	cspSource?: string;
}

const DEFAULT_SRCDOC = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body></body></html>';

const BRIDGE_SCRIPT = `<script>
(function () {
	var bridge = {
		postMessage: function (data) {
			window.parent.postMessage({ source: 'webview', data: data }, '*');
		},
		onMessage: function (callback) {
			window.addEventListener('message', function (event) {
				if (event.data && event.data.__dcFromHost === true) {
					callback(event.data.data);
				}
			});
		}
	};
	window.dcWebview = bridge;
})();
</script>`;

export class WebviewIframe extends Disposable {
	private readonly _onDidReceiveMessage = this._register(new Emitter<unknown>());
	readonly onDidReceiveMessage: Event<unknown> = this._onDidReceiveMessage.event;

	private _iframe: HTMLIFrameElement | undefined;
	private readonly _listener = (event: MessageEvent) => {
		if (!this._iframe || event.source !== this._iframe.contentWindow) {
			return;
		}
		const payload = event.data as { source?: string; data?: unknown } | undefined;
		if (payload && payload.source === 'webview') {
			this._onDidReceiveMessage.fire(payload.data);
		}
	};

	public create(hostElement: HTMLElement, options: IWebviewIframeOptions = {}): HTMLIFrameElement {
		this._cleanupIframe();
		const iframe = document.createElement('iframe');
		const sandboxTokens = ['allow-scripts', 'allow-modals', 'allow-forms'];
		if (options.allowScripts) {
			sandboxTokens.push('allow-same-origin');
		}
		iframe.setAttribute('sandbox', sandboxTokens.join(' '));
		iframe.style.border = 'none';
		iframe.style.width = '100%';
		iframe.style.height = '100%';
		let srcdoc = DEFAULT_SRCDOC;
		if (options.cspSource) {
			const csp = buildWebviewCsp(options.cspSource, { allowScripts: options.allowScripts ?? false });
			srcdoc = srcdoc.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`);
		}
		if (options.allowScripts) {
			srcdoc = srcdoc.replace('</body>', `${BRIDGE_SCRIPT}</body>`);
		}
		iframe.srcdoc = srcdoc;
		hostElement.appendChild(iframe);
		this._iframe = iframe;
		window.addEventListener('message', this._listener);
		return iframe;
	}

	public get iframe(): HTMLIFrameElement | undefined {
		return this._iframe;
	}

	public postMessageToWebview(message: unknown): void {
		this._iframe?.contentWindow?.postMessage({ __dcFromHost: true, data: message }, '*');
	}

	public override dispose(): void {
		window.removeEventListener('message', this._listener);
		this._cleanupIframe();
		super.dispose();
	}

	private _cleanupIframe(): void {
		if (this._iframe) {
			this._iframe.remove();
			this._iframe = undefined;
		}
	}
}
