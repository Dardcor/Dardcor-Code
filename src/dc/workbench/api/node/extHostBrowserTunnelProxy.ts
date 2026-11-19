/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../base/common/async.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { ISocket } from '../../../base/parts/ipc/common/ipc.net.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IAddress, IAddressProvider, IConnectionOptions, connectRemoteAgentTunnel } from '../../../platform/remote/common/remoteAgentConnection.js';
import { IRemoteConnectionData, RemoteConnectionType } from '../../../platform/remote/common/remoteAuthorityResolver.js';
import { IRemoteSocketFactoryService } from '../../../platform/remote/common/remoteSocketFactoryService.js';
import { nodeSocketFactory } from '../../../platform/remote/node/nodeSocketFactory.js';
import { TunnelProxy } from '../../../platform/tunnel/node/tunnelProxy.js';
import { MainContext, MainThreadBrowserTunnelProxyShape } from '../common/extHost.protocol.js';
import { IExtHostBrowserTunnelProxy } from '../common/extHostBrowserTunnelProxy.js';
import { IExtHostExtensionService } from '../common/extHostExtensionService.js';
import { IExtHostManagedSockets } from '../common/extHostManagedSockets.js';
import { IExtHostInitDataService } from '../common/extHostInitDataService.js';
import { IExtHostRpcService } from '../common/extHostRpcService.js';
import { ExtHostManagedSocket } from './extHostTunnelService.js';
import { ISignService } from '../../../platform/sign/common/sign.js';

export class NodeExtHostBrowserTunnelProxy extends Disposable implements IExtHostBrowserTunnelProxy {
	declare readonly _serviceBrand: undefined;

	private readonly _proxy: MainThreadBrowserTunnelProxyShape;
	private readonly _addressProvider = new MutableAddressProvider();

	private _enabled = false;
	private _connection: IRemoteConnectionData | null = null;

	private _tunnelProxy: TunnelProxy | undefined;
	private _startPromise: Promise<void> | undefined;

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
		@IExtHostInitDataService private readonly _initData: IExtHostInitDataService,
		@ISignService private readonly _signService: ISignService,
		@ILogService private readonly _logService: ILogService,
		@IExtHostManagedSockets private readonly _managedSockets: IExtHostManagedSockets,
		@IExtHostExtensionService extHostExtensionService: IExtHostExtensionService,
	) {
		super();
		this._proxy = extHostRpc.getProxy(MainContext.MainThreadBrowserTunnelProxy);
		this._setConnection(extHostExtensionService.getRemoteConnectionData());
		this._register(extHostExtensionService.onDidChangeRemoteConnectionData(() => this._setConnection(extHostExtensionService.getRemoteConnectionData())));
	}

	override dispose(): void {
		this._stop();
		super.dispose();
	}

	$setEnabled(enabled: boolean): void {
		if (this._initData.remote.isRemote) {
			return;
		}
		if (this._enabled === enabled) {
			return;
		}
		this._enabled = enabled;
		this._update();
	}

	private _setConnection(connection: IRemoteConnectionData | null): void {
		if (!connection) {
			return;
		}
		const changed = !!this._connection && !sameConnection(this._connection, connection);
		this._connection = connection;
		this._addressProvider.setAddress({ connectTo: connection.connectTo, connectionToken: connection.connectionToken });
		if (changed) {
			this._tunnelProxy?.drainConnectionPool();
		}
	}

	private _update(): void {
		if (this._enabled && !this._tunnelProxy && !this._startPromise) {
			this._start();
		} else if (!this._enabled) {
			this._stop();
		}
	}

	private _start(): void {
		const options = this._createConnectionOptions();
		const tunnelProxy = new TunnelProxy(
			(host, port) => connectRemoteAgentTunnel(options, host, port),
			this._logService,
		);
		const startPromise: Promise<void> = tunnelProxy.start().then(info => {
			if (this._startPromise !== startPromise) {
				tunnelProxy.dispose();
				return;
			}
			this._tunnelProxy = tunnelProxy;
			this._startPromise = undefined;
			this._proxy.$updateProxyInfo(info);
		}, err => {
			this._logService.error('[ExtHostBrowserTunnelProxy] Failed to start tunnel proxy:', err);
			if (this._startPromise === startPromise) {
				this._startPromise = undefined;
			}
			tunnelProxy.dispose();
		});
		this._startPromise = startPromise;
	}

	private _stop(): void {
		const wasActive = !!this._tunnelProxy || !!this._startPromise;
		this._tunnelProxy?.dispose();
		this._tunnelProxy = undefined;
		this._startPromise = undefined;
		if (wasActive) {
			this._proxy.$updateProxyInfo(undefined);
		}
	}

	private _createConnectionOptions(): IConnectionOptions {
		const managedSockets = this._managedSockets;
		const remoteSocketFactoryService: IRemoteSocketFactoryService = {
			_serviceBrand: undefined,
			async connect(connectTo, path: string, query: string, debugLabel: string): Promise<ISocket> {
				if (connectTo.type === RemoteConnectionType.Managed) {
					const result = await managedSockets.makeConnection();
					return ExtHostManagedSocket.connect(result, path, query, debugLabel);
				}
				return nodeSocketFactory.connect(connectTo, path, query, debugLabel);
			},
			register() {
				throw new Error('BrowserTunnelProxy socket factory does not support register()');
			},
		};

		return {
			commit: this._initData.commit,
			quality: this._initData.quality,
			addressProvider: this._addressProvider,
			remoteSocketFactoryService,
			signService: this._signService,
			logService: this._logService,
			ipcLogger: null,
		};
	}
}

class MutableAddressProvider implements IAddressProvider {
	private _address: IAddress | null = null;
	private _pending: DeferredPromise<IAddress> | null = null;

	getAddress(): Promise<IAddress> {
		if (this._address) {
			return Promise.resolve(this._address);
		}
		this._pending ??= new DeferredPromise<IAddress>();
		return this._pending.p;
	}

	setAddress(address: IAddress): void {
		this._address = address;
		this._pending?.complete(address);
		this._pending = null;
	}
}

function sameConnection(a: IRemoteConnectionData | null, b: IRemoteConnectionData | null): boolean {
	if (a === b) {
		return true;
	}
	if (!a || !b || a.connectionToken !== b.connectionToken) {
		return false;
	}
	const x = a.connectTo;
	const y = b.connectTo;
	if (x.type === RemoteConnectionType.Managed && y.type === RemoteConnectionType.Managed) {
		return x.id === y.id;
	}
	if (x.type === RemoteConnectionType.WebSocket && y.type === RemoteConnectionType.WebSocket) {
		return x.host === y.host && x.port === y.port;
	}
	return false;
}
