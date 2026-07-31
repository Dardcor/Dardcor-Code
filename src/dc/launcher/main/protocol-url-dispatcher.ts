import { BrowserWindow } from 'electron';

export type ProtocolActionType = 'open-file' | 'open-folder' | 'clone-repo' | 'settings' | 'open-settings' | 'install-extension' | 'unknown';

export interface ProtocolAction {
	type: ProtocolActionType;
	payload: Record<string, string>;
	raw: string;
}

export function parseProtocolUrl(url: string): ProtocolAction {
	const raw = url;
	try {
		const parsed = new URL(url);
		const host = parsed.hostname;
		const pathname = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
		const params: Record<string, string> = {};
		parsed.searchParams.forEach((value, key) => {
			params[key] = value;
		});

		if (parsed.protocol === 'file:') {
			return { type: 'open-file', payload: { path: decodeURIComponent(parsed.pathname) }, raw };
		}

		if (host === 'vscode' && pathname.startsWith('clone')) {
			const cloneUrl = params.url ?? params.repo ?? params['remote-url'] ?? '';
			return { type: 'clone-repo', payload: { url: cloneUrl }, raw };
		}

		if (host === 'open' || pathname === 'open' || pathname === 'open-file') {
			const target = params.path ?? params.file ?? params.url ?? '';
			return { type: 'open-file', payload: { path: target }, raw };
		}

		if (host === 'open-folder' || pathname === 'open-folder') {
			const target = params.path ?? params.folder ?? params.url ?? '';
			return { type: 'open-folder', payload: { path: target }, raw };
		}

		if (host === 'settings' || pathname === 'settings') {
			return { type: 'open-settings', payload: params, raw };
		}

		if (host === 'extension' || pathname === 'install-extension' || pathname === 'extension') {
			const extensionId = params.id ?? params.extension ?? params.name ?? '';
			return { type: 'install-extension', payload: { id: extensionId }, raw };
		}

		if (pathname) {
			const filePath = params.path ?? pathname;
			return { type: 'open-file', payload: { path: filePath }, raw };
		}

		return { type: 'settings', payload: params, raw };
	} catch {
		if (url.startsWith('file://')) {
			try {
				return { type: 'open-file', payload: { path: decodeURIComponent(url.slice(7)) }, raw };
			} catch {
				return { type: 'open-file', payload: { path: url.slice(7) }, raw };
			}
		}
		return { type: 'unknown', payload: {}, raw };
	}
}

export function buildProtocolUrl(scheme: string, host: string, params: Record<string, string>): string {
	const url = new URL(`${scheme}://${host}`);
	for (const [key, value] of Object.entries(params)) {
		url.searchParams.set(key, value);
	}
	return url.toString();
}

export function dispatchProtocolUrl(url: string, window?: BrowserWindow | null): boolean {
	const action = parseProtocolUrl(url);
	return executeAction(action, window);
}

export function executeAction(action: ProtocolAction, window?: BrowserWindow | null): boolean {
	const target = window && !window.isDestroyed() ? window : BrowserWindow.getAllWindows()[0];
	switch (action.type) {
		case 'open-file':
			if (action.payload.path) {
				notify(target, 'protocol:openFile', { path: action.payload.path });
				return true;
			}
			return false;
		case 'open-folder':
			if (action.payload.path) {
				notify(target, 'protocol:openFolder', { path: action.payload.path });
				return true;
			}
			return false;
		case 'clone-repo':
			if (action.payload.url) {
				notify(target, 'protocol:cloneRepo', { url: action.payload.url });
				return true;
			}
			return false;
		case 'open-settings':
			notify(target, 'protocol:openSettings', action.payload);
			return true;
		case 'install-extension':
			if (action.payload.id) {
				notify(target, 'protocol:installExtension', { id: action.payload.id });
				return true;
			}
			return false;
		default:
			return false;
	}
}

function notify(window: BrowserWindow | undefined, channel: string, payload: unknown): void {
	try {
		if (window && !window.isDestroyed()) {
			window.webContents.send(channel, payload);
		} else {
			console.log(`[protocol-url-dispatcher] ${channel}:`, payload);
		}
	} catch {
		// Ignore.
	}
}

export function getProtocolScheme(url: string): string | null {
	try {
		return new URL(url).protocol.replace(':', '');
	} catch {
		return null;
	}
}
