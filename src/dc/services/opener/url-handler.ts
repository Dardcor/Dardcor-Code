/**
 * Dardcor Code - URL Handler (Task 170)
 * Mirrors: vs/platform/url/common/url.ts (custom protocol scheme handler for `dc://`)
 */

import { createDecorator } from '../instantiation/annotations.js';
import { Disposable, IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { URI } from '../../core/types/uri.js';

export interface IURLHandler {
	handleURL(uri: URI): Promise<boolean>;
}

export const IURLService = createDecorator<IURLService>('urlService');

export interface IURLService {
	readonly _serviceBrand: undefined;
	readonly onDidOpenURL: Event<URI>;
	registerHandler(handler: IURLHandler): IDisposable;
	open(uri: URI): Promise<boolean>;
}

export function parseDcUrl(url: string): URI | null {
	try {
		if (!url.startsWith('dc:') && !url.startsWith('dc://')) {
			return null;
		}
		const parsed = new URL(url);
		return URI.from({
			scheme: parsed.protocol.replace(/:$/, ''),
			authority: parsed.hostname,
			path: parsed.pathname,
			query: parsed.search,
			fragment: parsed.hash,
		});
	} catch {
		return null;
	}
}

export class URLService extends Disposable implements IURLService {
	declare readonly _serviceBrand: undefined;

	private readonly _handlers: IURLHandler[] = [];

	private readonly _onDidOpenURL = this._register(new Emitter<URI>());
	readonly onDidOpenURL: Event<URI> = this._onDidOpenURL.event;

	constructor() {
		super();
	}

	registerHandler(handler: IURLHandler): IDisposable {
		this._handlers.unshift(handler);
		return {
			dispose: () => {
				const idx = this._handlers.indexOf(handler);
				if (idx >= 0) {
					this._handlers.splice(idx, 1);
				}
			},
		};
	}

	async open(uri: URI): Promise<boolean> {
		this._onDidOpenURL.fire(uri);
		for (const handler of this._handlers) {
			if (await handler.handleURL(uri)) {
				return true;
			}
		}
		return false;
	}
}
