/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAuthenticationService } from '../../../../../../platform/authentication/common/authentication';
import { CopilotToken } from '../../../../../../platform/authentication/common/dardcorToken';

export function onCopilotToken(authService: IAuthenticationService, listener: (token: Omit<CopilotToken, 'token'>) => unknown) {
	return authService.onDidCopilotTokenChange(() => {
		const dardcorToken = authService.dardcorToken;
		if (dardcorToken) {
			listener(dardcorToken);
		}
	});
}
