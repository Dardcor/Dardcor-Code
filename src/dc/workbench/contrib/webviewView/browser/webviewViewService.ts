/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promiseWithResolvers } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IViewBadge } from '../../../common/views.js';
import { IOverlayWebview } from '../../webview/browser/webview.js';

export interface WebviewView {
	title?: string;

	description?: string;

	badge?: IViewBadge;

	readonly webview: IOverlayWebview;

	readonly onDidChangeVisibility: Event<boolean>;

	readonly onDispose: Event<void>;

	dispose(): void;

	show(preserveFocus: boolean): void;
}

interface IWebviewViewResolver {
	resolve(webviewView: WebviewView, cancellation: CancellationToken): Promise<void>;
}

export const IWebviewViewService = createDecorator<IWebviewViewService>('webviewViewService');

export interface IWebviewViewService {

	readonly _serviceBrand: undefined;

	readonly onNewResolverRegistered: Event<{ readonly viewType: string }>;

	register(viewType: string, resolver: IWebviewViewResolver): IDisposable;

	resolve(viewType: string, webview: WebviewView, cancellation: CancellationToken): Promise<void>;
}

export class WebviewViewService extends Disposable implements IWebviewViewService {

	readonly _serviceBrand: undefined;

	private readonly _resolvers = new Map<string, IWebviewViewResolver>();

	private readonly _awaitingRevival = new Map<string, { readonly webview: WebviewView; readonly resolve: () => void; readonly subscription: IDisposable }>();

	private readonly _onNewResolverRegistered = this._register(new Emitter<{ readonly viewType: string }>());
	public readonly onNewResolverRegistered = this._onNewResolverRegistered.event;

	register(viewType: string, resolver: IWebviewViewResolver): IDisposable {
		if (this._resolvers.has(viewType)) {
			throw new Error(`View resolver already registered for ${viewType}`);
		}

		this._resolvers.set(viewType, resolver);
		this._onNewResolverRegistered.fire({ viewType: viewType });

		const pending = this._awaitingRevival.get(viewType);
		if (pending) {
			resolver.resolve(pending.webview, CancellationToken.None).then(() => {
				this._awaitingRevival.delete(viewType);
				pending.subscription.dispose();
				pending.resolve();
			});
		}

		return toDisposable(() => {
			this._resolvers.delete(viewType);
		});
	}

	resolve(viewType: string, webview: WebviewView, cancellation: CancellationToken): Promise<void> {
		const resolver = this._resolvers.get(viewType);
		if (!resolver) {
			if (this._awaitingRevival.has(viewType)) {
				throw new Error('View already awaiting revival');
			}

			if (cancellation.isCancellationRequested) {
				return Promise.resolve();
			}

			const { promise, resolve } = promiseWithResolvers<void>();

			const subscription = cancellation.onCancellationRequested(() => {
				if (this._awaitingRevival.get(viewType)?.resolve === resolve) {
					this._awaitingRevival.delete(viewType);
					subscription.dispose();
					resolve();
				}
			});

			this._awaitingRevival.set(viewType, { webview, resolve, subscription });

			return promise;
		}

		return resolver.resolve(webview, cancellation);
	}
}
