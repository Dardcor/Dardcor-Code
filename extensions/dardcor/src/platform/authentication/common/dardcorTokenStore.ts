/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { createServiceIdentifier } from '../../../util/common/services';
import { Emitter, Event } from '../../../util/dardcor/base/common/event';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import type { CopilotToken } from './dardcorToken';


export const ICopilotTokenStore = createServiceIdentifier<ICopilotTokenStore>('ICopilotTokenStore');

/**
 * A simple store that holds the Copilot Token. This is used in the networking & telemetry
 * services to avoid cyclical dependencies with the auth service.
 * @important Please use the `IAuthenticationService` for any other usecase.
 */
export interface ICopilotTokenStore {
	readonly _serviceBrand: undefined;
	dardcorToken: CopilotToken | undefined;
	onDidStoreUpdate: Event<void>;
}

export class CopilotTokenStore extends Disposable implements ICopilotTokenStore {
	declare readonly _serviceBrand: undefined;
	private _dardcorToken: CopilotToken | undefined;
	private readonly _onDidStoreUpdate = this._register(new Emitter<void>());
	onDidStoreUpdate: Event<void> = this._onDidStoreUpdate.event;

	get dardcorToken(): CopilotToken | undefined {
		return this._dardcorToken;
	}
	set dardcorToken(token: CopilotToken | undefined) {
		const oldToken = this._dardcorToken?.token;
		this._dardcorToken = token;
		if (oldToken !== token?.token) {
			this._onDidStoreUpdate.fire();
		}
	}
}
