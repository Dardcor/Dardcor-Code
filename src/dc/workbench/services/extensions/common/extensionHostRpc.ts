import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IExtensionHostRpcProtocol {
	getProxy<T>(identifier: any): T;
	set<T, R extends T>(identifier: any, instance: R): R;
	assertRegistered(identifiers: any[]): void;
}

export class ExtensionHostRpcProtocol implements IExtensionHostRpcProtocol {
	private readonly _locals = new Map<string, any>();
	private readonly _proxies = new Map<string, any>();

	getProxy<T>(identifier: any): T {
		const id = identifier.id;
		if (!this._proxies.has(id)) {
			// Create a mock proxy
			this._proxies.set(id, new Proxy({}, {
				get: (target, prop) => {
					return async (...args: any[]) => {
						console.log(`RPC call to ${id}.${String(prop)}`, args);
					};
				}
			}));
		}
		return this._proxies.get(id);
	}

	set<T, R extends T>(identifier: any, instance: R): R {
		this._locals.set(identifier.id, instance);
		return instance;
	}

	assertRegistered(identifiers: any[]): void {
		for (const id of identifiers) {
			if (!this._locals.has(id.id)) {
				console.warn(`RPC identifier ${id.id} is not registered`);
			}
		}
	}
}
