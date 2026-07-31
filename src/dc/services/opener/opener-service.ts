/**
 * Dardcor Code - External/Internal URL Opener Router (Task 137)
 */

import { createDecorator } from '../instantiation/annotations.js';
import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { URI } from '../../core/types/uri.js';

export interface IOpenOptions {
	readonly openExternal?: boolean;
	readonly allowTabs?: boolean;
	readonly fromUserGesture?: boolean;
}

export interface IExternalOpener {
	open(resource: URI, options?: IOpenOptions): Promise<boolean>;
}

export interface IOpenerService {
	readonly _serviceBrand: undefined;
	open(resource: URI | string, options?: IOpenOptions): Promise<boolean>;
	registerOpener(scheme: string, opener: IExternalOpener): IDisposable;
	registerInternalHandler(handler: (resource: URI, options: IOpenOptions) => Promise<boolean>): IDisposable;
	getSupportedSchemes(): string[];
}

export const IOpenerService = createDecorator<IOpenerService>('openerService');

type OpenerHandler = (resource: URI, options: IOpenOptions) => Promise<boolean>;

const INTERNAL_SCHEME = 'dc';

export class OpenerService extends Disposable implements IOpenerService {
	declare readonly _serviceBrand: undefined;

	private readonly _openers = new Map<string, OpenerHandler>();
	private _internalHandler: OpenerHandler | null = null;

	public registerOpener(scheme: string, opener: IExternalOpener): IDisposable {
		const handler: OpenerHandler = (resource, options) => opener.open(resource, options);
		this._openers.set(scheme, handler);
		return toDisposable(() => {
			if (this._openers.get(scheme) === handler) {
				this._openers.delete(scheme);
			}
		});
	}

	public registerInternalHandler(handler: (resource: URI, options: IOpenOptions) => Promise<boolean>): IDisposable {
		const wrapped: OpenerHandler = (resource, options) => handler(resource, options);
		this._internalHandler = wrapped;
		return toDisposable(() => {
			if (this._internalHandler === wrapped) {
				this._internalHandler = null;
			}
		});
	}

	public getSupportedSchemes(): string[] {
		return [...this._openers.keys()];
	}

	public async open(resource: URI | string, options: IOpenOptions = {}): Promise<boolean> {
		const uri = typeof resource === 'string' ? URI.parse(resource) : resource;
		if (uri.scheme === INTERNAL_SCHEME) {
			return this._internalHandler ? this._internalHandler(uri, options) : false;
		}
		const opener = this._openers.get(uri.scheme);
		if (opener) {
			return opener(uri, options);
		}
		if (uri.scheme === 'file' || uri.scheme === 'http' || uri.scheme === 'https') {
			return this._openWithDefaultApp(uri);
		}
		return false;
	}

	private async _openWithDefaultApp(uri: URI): Promise<boolean> {
		// Desktop: Electron shell opens the URI with the OS default application.
		try {
			const electron = await import('electron');
			const shell = (electron as any).shell;
			if (shell && typeof shell.openExternal === 'function') {
				await shell.openExternal(uri.toString());
				return true;
			}
		} catch {
			// Not running inside Electron - try the browser.
		}
		if (typeof window !== 'undefined' && typeof window.open === 'function') {
			const opened = window.open(uri.toString(), '_blank');
			if (opened) {
				return true;
			}
		}
		return false;
	}
}
