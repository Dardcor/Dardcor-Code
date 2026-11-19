/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../base/common/async.js';
import { CancellationTokenSource } from '../../../base/common/cancellation.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable, dispose, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';

export class RequestStore<T, RequestArgs> extends Disposable {
	private _lastRequestId = 0;
	private readonly _timeout: number;
	private _pendingRequests: Map<number, (resolved: T) => void> = new Map();
	private _pendingRequestDisposables: Map<number, IDisposable[]> = new Map();

	private readonly _onCreateRequest = this._register(new Emitter<RequestArgs & { requestId: number }>());
	readonly onCreateRequest = this._onCreateRequest.event;

	constructor(
		timeout: number | undefined,
		@ILogService private readonly _logService: ILogService
	) {
		super();
		this._timeout = timeout === undefined ? 15000 : timeout;
		this._register(toDisposable(() => {
			for (const d of this._pendingRequestDisposables.values()) {
				dispose(d);
			}
		}));
	}

	createRequest(args: RequestArgs): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const requestId = ++this._lastRequestId;
			this._pendingRequests.set(requestId, resolve);
			this._onCreateRequest.fire({ requestId, ...args });
			const tokenSource = new CancellationTokenSource();
			timeout(this._timeout, tokenSource.token).then(() => reject(`Request ${requestId} timed out (${this._timeout}ms)`));
			this._pendingRequestDisposables.set(requestId, [toDisposable(() => tokenSource.cancel())]);
		});
	}

	acceptReply(requestId: number, data: T) {
		const resolveRequest = this._pendingRequests.get(requestId);
		if (resolveRequest) {
			this._pendingRequests.delete(requestId);
			dispose(this._pendingRequestDisposables.get(requestId) || []);
			this._pendingRequestDisposables.delete(requestId);
			resolveRequest(data);
		} else {
			this._logService.warn(`RequestStore#acceptReply was called without receiving a matching request ${requestId}`);
		}
	}
}
