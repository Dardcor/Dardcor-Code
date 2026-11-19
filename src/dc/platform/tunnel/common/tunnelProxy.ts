/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ITunnelProxyInfo {
	url: string;
	host: string;
	port: number;
	credentials: { username: string; password: string };
	certFingerprint: string;
}
