/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { ProtectedResourceMetadata, URI } from './state.js';

export const enum AuthRequiredReason {
	Required = 'required',
	Expired = 'expired',
}


export interface AuthRequiredParams {
	channel: URI;
	resource: ProtectedResourceMetadata;
	reason?: AuthRequiredReason;
}
