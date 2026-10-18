/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { IWebWorkerService } from '../../../platform/webWorker/browser/webWorkerService.js';
import { EditorWorkerClient } from '../../browser/services/editorWorkerService.js';
import { IModelService } from '../../common/services/model.js';

export function createWebWorker<T extends object>(modelService: IModelService, webWorkerService: IWebWorkerService, opts: IInternalWebWorkerOptions): MonacoWebWorker<T> {
	return new MonacoWebWorkerImpl<T>(modelService, webWorkerService, opts);
}

export interface MonacoWebWorker<T> {
	dispose(): void;
	getProxy(): Promise<T>;
	withSyncedResources(resources: URI[]): Promise<T>;
}

export interface IInternalWebWorkerOptions {
	worker: Worker | Promise<Worker>;
	host?: Record<string, Function>;
	keepIdleModels?: boolean;
}

class MonacoWebWorkerImpl<T extends object> extends EditorWorkerClient implements MonacoWebWorker<T> {

	private readonly _foreignModuleHost: { [method: string]: Function } | null;
	private _foreignProxy: Promise<T>;

	constructor(modelService: IModelService, webWorkerService: IWebWorkerService, opts: IInternalWebWorkerOptions) {
		super(opts.worker, opts.keepIdleModels || false, modelService, webWorkerService);
		this._foreignModuleHost = opts.host || null;
		this._foreignProxy = this._getProxy().then(proxy => {
			return new Proxy({}, {
				get(target, prop, receiver) {
					if (prop === 'then') {
						return undefined;
					}
					if (typeof prop !== 'string') {
						throw new Error(`Not supported`);
					}
					return (...args: unknown[]) => {
						return proxy.$fmr(prop, args);
					};
				}
			}) as T;
		});
	}

	public override fhr(method: string, args: unknown[]): Promise<unknown> {
		if (!this._foreignModuleHost || typeof this._foreignModuleHost[method] !== 'function') {
			return Promise.reject(new Error('Missing method ' + method + ' or missing main thread foreign host.'));
		}

		try {
			return Promise.resolve(this._foreignModuleHost[method].apply(this._foreignModuleHost, args));
		} catch (e) {
			return Promise.reject(e);
		}
	}

	public getProxy(): Promise<T> {
		return this._foreignProxy;
	}

	public withSyncedResources(resources: URI[]): Promise<T> {
		return this.workerWithSyncedResources(resources).then(_ => this.getProxy());
	}
}
