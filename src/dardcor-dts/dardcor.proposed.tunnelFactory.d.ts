/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
	export interface TunnelInformation {
		environmentTunnels?: TunnelDescription[];

		tunnelFeatures?: {
			elevation: boolean;
			privacyOptions: TunnelPrivacy[];
			protocol?: boolean;
		};
	}

	export interface TunnelProvider {
		provideTunnel(tunnelOptions: TunnelOptions, tunnelCreationOptions: TunnelCreationOptions, token: CancellationToken): ProviderResult<Tunnel>;
	}

	export namespace workspace {
		export function registerTunnelProvider(provider: TunnelProvider, information: TunnelInformation): Thenable<Disposable>;
	}

}
