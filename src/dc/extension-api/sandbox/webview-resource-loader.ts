import { URI } from '../../core/types/uri.js';

const SCHEME = 'webview-resource';

export class WebviewResourceLoader {
	private readonly _resolutionMap = new Map<string, string>();

	public asWebviewUri(resource: URI, webviewId: string): URI {
		const encoded = Buffer.from(resource.toString(), 'utf8').toString('base64url');
		this._resolutionMap.set(`${webviewId}:${encoded}`, resource.toString());
		return URI.from({ scheme: SCHEME, authority: webviewId, path: `/${encoded}` });
	}

	public resolveWebviewResource(webviewId: string, path: string): URI {
		const normalized = path.startsWith('/') ? path.substring(1) : path;
		const original = this._resolutionMap.get(`${webviewId}:${normalized}`);
		if (!original) {
			throw new Error(`Sumber daya webview tidak dikenal: ${webviewId}${path}`);
		}
		return URI.parse(original);
	}

	public clear(webviewId?: string): void {
		if (webviewId === undefined) {
			this._resolutionMap.clear();
			return;
		}
		for (const key of this._resolutionMap.keys()) {
			if (key.startsWith(`${webviewId}:`)) {
				this._resolutionMap.delete(key);
			}
		}
	}
}
