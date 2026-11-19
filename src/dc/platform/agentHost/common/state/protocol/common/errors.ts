/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { ProtectedResourceMetadata } from './state.js';
import type { ResourceRequestParams } from './commands.js';


export const JsonRpcErrorCodes = {
	ParseError: -32700,
	InvalidRequest: -32600,
	MethodNotFound: -32601,
	InvalidParams: -32602,
	InternalError: -32603,
} as const;


export const AhpErrorCodes = {
	SessionNotFound: -32001,
	ProviderNotFound: -32002,
	SessionAlreadyExists: -32003,
	TurnInProgress: -32004,
	UnsupportedProtocolVersion: -32005,
	AuthRequired: -32007,
	NotFound: -32008,
	PermissionDenied: -32009,
	AlreadyExists: -32010,
	Conflict: -32011,
} as const;

export type AhpErrorCode = (typeof AhpErrorCodes)[keyof typeof AhpErrorCodes];

export type JsonRpcErrorCode = (typeof JsonRpcErrorCodes)[keyof typeof JsonRpcErrorCodes];


export interface AuthRequiredErrorData {
	resources: ProtectedResourceMetadata[];
}

export interface PermissionDeniedErrorData {
	request?: ResourceRequestParams;
}

export interface UnsupportedProtocolVersionErrorData {
	supportedVersions: string[];
}

export interface AhpErrorDetailsMap {
	[AhpErrorCodes.AuthRequired]: AuthRequiredErrorData;
	[AhpErrorCodes.PermissionDenied]: PermissionDeniedErrorData;
	[AhpErrorCodes.UnsupportedProtocolVersion]: UnsupportedProtocolVersionErrorData;
}

export type AhpErrorCodeWithData = keyof AhpErrorDetailsMap;

export type AhpError<C extends AhpErrorCode = AhpErrorCode> =
	C extends AhpErrorCode
	? C extends keyof AhpErrorDetailsMap
	? {
		readonly code: C;
		readonly message: string;
		readonly data: AhpErrorDetailsMap[C];
	}
	: {
		readonly code: C;
		readonly message: string;
		readonly data?: unknown;
	}
	: never;
