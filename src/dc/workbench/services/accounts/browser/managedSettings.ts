/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPolicyData } from '../../../../base/common/defaultAccount.js';
import { normalizeManagedSettings } from '../../../../platform/policy/common/dardcorManagedSettings.js';

export type IManagedMcpServerMatcher =
	| { readonly serverName: string }
	| { readonly serverUrl: string }
	| { readonly serverCommand: readonly string[] };

export interface IManagedSettingsResponse {
	readonly permissions?: {
		readonly disableBypassPermissionsMode?: string;
	};
	readonly enabledPlugins?: Record<string, boolean>;
	readonly extraKnownMarketplaces?: Record<string, {
		readonly source:
		| { readonly source: 'github'; readonly repo: string; readonly ref?: string }
		| { readonly source: 'git'; readonly url: string; readonly ref?: string };
	}>;
	readonly strictKnownMarketplaces?: readonly unknown[];
	readonly allowedMcpServers?: ReadonlyArray<IManagedMcpServerMatcher>;
	readonly deniedMcpServers?: ReadonlyArray<IManagedMcpServerMatcher>;
	readonly strictPluginOnlyCustomization?: boolean;
	readonly allowManagedMcpServersOnly?: boolean;
	readonly allowManagedHooksOnly?: boolean;
	readonly forceRemoteSettingsRefresh?: boolean;
	readonly telemetry?: {
		readonly enabled?: boolean;
		readonly endpoint?: string;
		readonly protocol?: 'grpc' | 'http/protobuf' | 'http/json';
		readonly captureContent?: boolean;
		readonly lockCaptureContent?: boolean;
		readonly serviceName?: string;
		readonly resourceAttributes?: Record<string, string>;
		readonly headers?: Record<string, string>;
	};
	readonly [key: string]: unknown;
}

export function adaptManagedSettings(response: IManagedSettingsResponse, onWarn?: (msg: string) => void): Partial<IPolicyData> {
	return { managedSettings: normalizeManagedSettings(response as Record<string, unknown>, onWarn) };
}
