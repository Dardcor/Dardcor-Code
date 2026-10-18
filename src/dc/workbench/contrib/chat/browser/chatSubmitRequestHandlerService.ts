/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { toDisposable, type IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IChatSubmitRequestHandlerService = createDecorator<IChatSubmitRequestHandlerService>('chatSubmitRequestHandlerService');

export interface IChatSubmitRequest {
	readonly sessionResource: URI;
	readonly providerId?: string;
	readonly sessionId?: string;
	readonly input: string;
}

export interface IChatSubmitRequestHandler {
	readonly id: string;
	tryHandle(request: IChatSubmitRequest): Promise<boolean>;
}

export interface IChatSubmitRequestHandlerService {
	readonly _serviceBrand: undefined;
	register(handler: IChatSubmitRequestHandler): IDisposable;
	tryHandle(request: IChatSubmitRequest): Promise<boolean>;
}

export class ChatSubmitRequestHandlerService implements IChatSubmitRequestHandlerService {

	declare readonly _serviceBrand: undefined;

	private readonly _handlers: IChatSubmitRequestHandler[] = [];

	register(handler: IChatSubmitRequestHandler): IDisposable {
		this._handlers.push(handler);
		return toDisposable(() => {
			const index = this._handlers.indexOf(handler);
			if (index >= 0) {
				this._handlers.splice(index, 1);
			}
		});
	}

	async tryHandle(request: IChatSubmitRequest): Promise<boolean> {
		for (const handler of this._handlers) {
			if (await handler.tryHandle(request)) {
				return true;
			}
		}
		return false;
	}
}
