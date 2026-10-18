/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { ITunnelProxyInfo } from '../../tunnel/common/tunnelProxy.js';
import { BrowserViewStorageScope } from '../common/browserView.js';
import type { BrowserSession } from './browserSession.js';

export interface IBrowserSessionRemote {
	readonly onDidStart: Event<void>;
	readonly onDidStop: Event<void>;
	readonly isRemote: boolean;
	readonly proxy: ITunnelProxyInfo | undefined;
	readonly whenReady: Promise<void>;
	acquire(viewId: string, proxyInfo: ITunnelProxyInfo | undefined): void;
	release(viewId: string): void;
}

export class BrowserSessionRemote implements IBrowserSessionRemote {

	private _proxy: ITunnelProxyInfo | undefined;
	private _readyPromise: Promise<void> = Promise.resolve();

	private readonly _viewIds = new Set<string>();

	private readonly _onDidStart = new Emitter<void>();
	readonly onDidStart: Event<void> = this._onDidStart.event;

	private readonly _onDidStop = new Emitter<void>();
	readonly onDidStop: Event<void> = this._onDidStop.event;

	constructor(
		private readonly _session: BrowserSession,
	) {
	}

	get isRemote(): boolean {
		return this._proxy !== undefined;
	}

	get proxy(): ITunnelProxyInfo | undefined {
		return this._proxy;
	}

	get whenReady(): Promise<void> {
		return this._readyPromise;
	}

	acquire(viewId: string, proxyInfo: ITunnelProxyInfo | undefined): void {
		if (!proxyInfo || this._session.storageScope === BrowserViewStorageScope.Global) {
			this.release(viewId);
			return;
		}
		this._viewIds.add(viewId);
		this._setProxy(proxyInfo);
	}

	release(viewId: string): void {
		if (!this._viewIds.delete(viewId)) {
			return;
		}
		if (this._viewIds.size === 0) {
			this._setProxy(undefined);
		}
	}

	private _setProxy(info: ITunnelProxyInfo | undefined): void {
		if (sameProxyInfo(this._proxy, info)) {
			return;
		}
		const wasRemote = this._proxy !== undefined;
		this._proxy = info;
		this._readyPromise = this._applyProxy();
		if (info) {
			this._onDidStart.fire();
		} else if (wasRemote) {
			this._onDidStop.fire();
		}
	}

	private _applyProxy(): Promise<void> {
		if (this._proxy) {
			return this._session.electronSession.setProxy({
				proxyRules: this._proxy.url,
				proxyBypassRules: '<-loopback>'
			});
		}
		return this._session.electronSession.setProxy({ mode: 'direct' });
	}
}

function sameProxyInfo(a: ITunnelProxyInfo | undefined, b: ITunnelProxyInfo | undefined): boolean {
	if (a === b) {
		return true;
	}
	if (!a || !b) {
		return false;
	}
	return a.url === b.url
		&& a.certFingerprint === b.certFingerprint
		&& a.credentials.username === b.credentials.username
		&& a.credentials.password === b.credentials.password;
}
