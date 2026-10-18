/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export interface TunnelOptions {
		remoteAddress: { port: number; host: string };
		localAddressPort?: number;
		label?: string;
		public?: boolean;
		privacy?: string;
		protocol?: string;
	}

	export interface TunnelDescription {
		remoteAddress: { port: number; host: string };
		localAddress: { port: number; host: string } | string;
		public?: boolean;
		privacy?: string;
		protocol?: string;
	}

	export interface Tunnel extends TunnelDescription {
		readonly onDidDispose: Event<void>;
		dispose(): void | Thenable<void>;
	}

	export namespace workspace {
		export function openTunnel(tunnelOptions: TunnelOptions): Thenable<Tunnel>;

		export let tunnels: Thenable<TunnelDescription[]>;

		export const onDidChangeTunnels: Event<void>;
	}
}
