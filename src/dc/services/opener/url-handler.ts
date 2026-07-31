/**
 * Dardcor Code - URL Handler (Task 170)
 * Mirrors: vs/platform/url/common/url.ts custom protocol scheme handler (`dc://`)
 */

import { IDisposable } from '../../core/lifecycle/disposable.js';
import { URI } from '../../core/types/uri.js';

export interface IURLHandler {
	handleURL(uri: URI): Promise<boolean>;
}

export const IURLService = Symbol('IURLService');

export interface IURLService {
	registerHandler(handler: IURLHandler): IDisposable;
	open(uri: URI): Promise<boolean>;
}

export class URLService implements IURLService {
	private readonly _handlers: IURLHandler[] = [];

	registerHandler(handler: IURLHandler): IDisposable {
		this._handlers.unshift(handler);
		return {
			dispose: () => {
				const idx = this._handlers.indexOf(handler);
				if (idx >= 0) this._handlers.splice(idx, 1);
			}
		};
	}

	async open(uri: URI): Promise<boolean> {
		for (const h of this._handlers) {
			if (await h.handleURL(uri)) return true;
		}
		return false;
	}
}
