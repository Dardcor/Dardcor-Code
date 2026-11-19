/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/




export type {
	JsonRpcErrorResponse,
	JsonRpcNotification,
	JsonRpcRequest,
	JsonRpcResponse,
	JsonRpcSuccessResponse,
} from './protocol/messages.js';

export interface JsonRpcParseErrorResponse {
	readonly jsonrpc: '2.0';
	readonly id: null;
	readonly error: JsonRpcErrorResponse['error'];
}

export type {
	AhpClientNotification,
	AhpNotification,
	AhpRequest,
	AhpResponse,
	AhpServerNotification,
	AhpSuccessResponse,
	CommandMap,
	ClientNotificationMap,
	ProtocolMessage,
	ServerNotificationMap,
} from './protocol/messages.js';

export type {
	CreateSessionParams,
	DirectoryEntry,
	DispatchActionParams,
	DisposeSessionParams,
	FetchTurnsParams,
	FetchTurnsResult,
	InitializeParams,
	InitializeResult,
	ListSessionsParams,
	ListSessionsResult,
	ReconnectParams,
	ReconnectReplayResult,
	ReconnectResult,
	ReconnectSnapshotResult,
	ResourceCopyParams,
	ResourceCopyResult,
	ResourceDeleteParams,
	ResourceDeleteResult,
	ResourceListParams,
	ResourceListResult,
	ResourceMkdirParams,
	ResourceMkdirResult,
	ResourceMoveParams,
	ResourceMoveResult,
	ResourceReadParams,
	ResourceReadResult,
	ResourceResolveParams,
	ResourceResolveResult,
	ResourceWriteParams,
	ResourceWriteResult,
	SubscribeParams,
	SubscribeResult,
	UnsubscribeParams,
} from './protocol/commands.js';

export type {
	CreateResourceWatchParams,
	CreateResourceWatchResult,
} from './protocol/channels-resource-watch/commands.js';

export { ContentEncoding, ReconnectResultType, ResourceType, ResourceWriteMode } from './protocol/commands.js';
export { ResourceChangeType } from './protocol/channels-resource-watch/state.js';
export type { ResourceChange, ResourceWatchState } from './protocol/channels-resource-watch/state.js';

export { AhpErrorCodes, JsonRpcErrorCodes } from './protocol/errors.js';
export type { AhpErrorCode, JsonRpcErrorCode } from './protocol/errors.js';


import type { Snapshot as ProtocolSnapshot } from './protocol/state.js';
export type IStateSnapshot = ProtocolSnapshot;


export const JSON_RPC_PARSE_ERROR = -32700 as const;
export const JSON_RPC_INTERNAL_ERROR = -32603 as const;
export const AHP_SESSION_NOT_FOUND = -32001 as const;
export const AHP_PROVIDER_NOT_FOUND = -32002 as const;
export const AHP_SESSION_ALREADY_EXISTS = -32003 as const;
export const AHP_TURN_IN_PROGRESS = -32004 as const;
export const AHP_UNSUPPORTED_PROTOCOL_VERSION = -32005 as const;
export const AHP_CONTENT_NOT_FOUND = -32006 as const;
export const AHP_AUTH_REQUIRED = -32007 as const;

export const AHP_NOT_FOUND = -32008 as const;


import type { AhpRequest, AhpNotification, AhpSuccessResponse, ProtocolMessage, JsonRpcErrorResponse } from './protocol/messages.js';

export function isJsonRpcRequest(msg: ProtocolMessage): msg is AhpRequest {
	return 'method' in msg && 'id' in msg;
}

export function isJsonRpcNotification(msg: ProtocolMessage): msg is AhpNotification {
	return 'method' in msg && !('id' in msg);
}

export function isJsonRpcResponse(msg: ProtocolMessage): msg is AhpSuccessResponse | JsonRpcErrorResponse {
	return 'id' in msg && !('method' in msg);
}


export class ProtocolError extends Error {
	constructor(readonly code: number, message: string, readonly data?: unknown) {
		super(message);
	}
}

export interface ISetAuthTokenParams {
	readonly token: string;
}


import type { INotification } from './sessionActions.js';

export interface INotificationBroadcastParams {
	readonly notification: INotification;
}
