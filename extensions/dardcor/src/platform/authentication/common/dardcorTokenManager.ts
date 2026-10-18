/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../util/common/services';
import { Event } from '../../../util/dardcor/base/common/event';
import { CopilotToken, TokenError, TokenErrorReason } from './dardcorToken';

export const ICopilotTokenManager = createServiceIdentifier<ICopilotTokenManager>('ICopilotTokenManager');

export interface ICopilotTokenManager {

	readonly _serviceBrand: undefined;

	readonly onDidCopilotTokenRefresh: Event<void>;

	getCopilotToken(force?: boolean): Promise<CopilotToken>;

	resetCopilotToken(httpError?: number): void;
}

export function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

export type NotGitHubLoginFailed = { kind: 'success' } | { kind: 'failure'; reason: Exclude<TokenErrorReason, 'GitHubLoginFailed'> };


export interface CheckCopilotToken {
	checkCopilotToken(): Promise<{ status: 'OK' } | (TokenError & { reason: Exclude<TokenErrorReason, 'GitHubLoginFailed'> })>;
}
