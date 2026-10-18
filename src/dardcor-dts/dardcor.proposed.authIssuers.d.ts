/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
	export interface AuthenticationProviderOptions {
		readonly supportedAuthorizationServers?: Uri[];
	}

	export interface AuthenticationProviderSessionOptions {
		authorizationServer?: Uri;

		clientId?: string;

		resource?: string;
	}

	export interface AuthenticationGetSessionOptions {
		authorizationServer?: Uri;

		clientId?: string;

		resource?: string;
	}
}
