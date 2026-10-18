/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { InitializeParams, InitializeResult, PingParams, ReconnectParams, ReconnectResult, SubscribeParams, SubscribeResult, ResourceReadParams, ResourceReadResult, ResourceWriteParams, ResourceWriteResult, ResourceListParams, ResourceListResult, ResourceCopyParams, ResourceCopyResult, ResourceDeleteParams, ResourceDeleteResult, ResourceMoveParams, ResourceMoveResult, ResourceResolveParams, ResourceResolveResult, ResourceMkdirParams, ResourceMkdirResult, ResourceRequestParams, ResourceRequestResult, UnsubscribeParams, DispatchActionParams, AuthenticateParams, AuthenticateResult } from './commands.js';
import type { ListSessionsParams, ListSessionsResult, ResolveSessionConfigParams, ResolveSessionConfigResult, SessionConfigCompletionsParams, SessionConfigCompletionsResult } from '../channels-root/commands.js';
import type { CreateSessionParams, DisposeSessionParams, FetchTurnsParams, FetchTurnsResult, CompletionsParams, CompletionsResult } from '../channels-session/commands.js';
import type { CreateChatParams, DisposeChatParams } from '../channels-chat/commands.js';
import type { CreateTerminalParams, DisposeTerminalParams } from '../channels-terminal/commands.js';
import type { CreateResourceWatchParams, CreateResourceWatchResult } from '../channels-resource-watch/commands.js';
import type { InvokeChangesetOperationParams, InvokeChangesetOperationResult } from '../channels-changeset/commands.js';
import type { ListAutomationTriggerDefinitionsParams, ListAutomationTriggerDefinitionsResult, RunAutomationParams, RunAutomationResult, FetchAutomationRunsParams, FetchAutomationRunsResult } from '../channels-automation/commands.js';

import type { ActionEnvelope } from './actions.js';
import type { SessionAddedParams, SessionRemovedParams, SessionSummaryChangedParams, ProgressParams } from '../channels-root/notifications.js';
import type { AuthRequiredParams } from './notifications.js';
import type { OtlpExportLogsParams, OtlpExportTracesParams, OtlpExportMetricsParams } from '../channels-otlp/notifications.js';
import type { AhpError } from './errors.js';


export interface JsonRpcRequest {
	readonly jsonrpc: '2.0';
	readonly id: number;
	readonly method: string;
	readonly params?: unknown;
}

export interface JsonRpcSuccessResponse {
	readonly jsonrpc: '2.0';
	readonly id: number;
	readonly result: unknown;
}

export interface JsonRpcErrorResponse {
	readonly jsonrpc: '2.0';
	readonly id: number;
	readonly error: {
		readonly code: number;
		readonly message: string;
		readonly data?: unknown;
	};
}

export interface AhpErrorResponse {
	readonly jsonrpc: '2.0';
	readonly id: number;
	readonly error: AhpError;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export interface JsonRpcNotification {
	readonly jsonrpc: '2.0';
	readonly method: string;
	readonly params?: unknown;
}


export interface CommandMap {
	'initialize': { params: InitializeParams; result: InitializeResult };
	'ping': { params: PingParams; result: null };
	'reconnect': { params: ReconnectParams; result: ReconnectResult };
	'subscribe': { params: SubscribeParams; result: SubscribeResult };
	'createSession': { params: CreateSessionParams; result: null };
	'disposeSession': { params: DisposeSessionParams; result: null };
	'createChat': { params: CreateChatParams; result: null };
	'disposeChat': { params: DisposeChatParams; result: null };
	'createTerminal': { params: CreateTerminalParams; result: null };
	'disposeTerminal': { params: DisposeTerminalParams; result: null };
	'createResourceWatch': { params: CreateResourceWatchParams; result: CreateResourceWatchResult };
	'listSessions': { params: ListSessionsParams; result: ListSessionsResult };
	'resourceRead': { params: ResourceReadParams; result: ResourceReadResult };
	'resourceWrite': { params: ResourceWriteParams; result: ResourceWriteResult };
	'resourceList': { params: ResourceListParams; result: ResourceListResult };
	'resourceCopy': { params: ResourceCopyParams; result: ResourceCopyResult };
	'resourceDelete': { params: ResourceDeleteParams; result: ResourceDeleteResult };
	'resourceMove': { params: ResourceMoveParams; result: ResourceMoveResult };
	'resourceResolve': { params: ResourceResolveParams; result: ResourceResolveResult };
	'resourceMkdir': { params: ResourceMkdirParams; result: ResourceMkdirResult };
	'resourceRequest': { params: ResourceRequestParams; result: ResourceRequestResult };
	'fetchTurns': { params: FetchTurnsParams; result: FetchTurnsResult };
	'authenticate': { params: AuthenticateParams; result: AuthenticateResult };
	'resolveSessionConfig': { params: ResolveSessionConfigParams; result: ResolveSessionConfigResult };
	'sessionConfigCompletions': { params: SessionConfigCompletionsParams; result: SessionConfigCompletionsResult };
	'completions': { params: CompletionsParams; result: CompletionsResult };
	'invokeChangesetOperation': { params: InvokeChangesetOperationParams; result: InvokeChangesetOperationResult };
	'listAutomationTriggerDefinitions': { params: ListAutomationTriggerDefinitionsParams; result: ListAutomationTriggerDefinitionsResult };
	'runAutomation': { params: RunAutomationParams; result: RunAutomationResult };
	'fetchAutomationRuns': { params: FetchAutomationRunsParams; result: FetchAutomationRunsResult };
}

export interface ServerCommandMap {
	'resourceRead': { params: ResourceReadParams; result: ResourceReadResult };
	'resourceWrite': { params: ResourceWriteParams; result: ResourceWriteResult };
	'resourceList': { params: ResourceListParams; result: ResourceListResult };
	'resourceCopy': { params: ResourceCopyParams; result: ResourceCopyResult };
	'resourceDelete': { params: ResourceDeleteParams; result: ResourceDeleteResult };
	'resourceMove': { params: ResourceMoveParams; result: ResourceMoveResult };
	'resourceResolve': { params: ResourceResolveParams; result: ResourceResolveResult };
	'resourceMkdir': { params: ResourceMkdirParams; result: ResourceMkdirResult };
	'resourceRequest': { params: ResourceRequestParams; result: ResourceRequestResult };
	'createResourceWatch': { params: CreateResourceWatchParams; result: CreateResourceWatchResult };
}


export interface ClientNotificationMap {
	'unsubscribe': { params: UnsubscribeParams };
	'dispatchAction': { params: DispatchActionParams };
}

export interface ServerNotificationMap {
	'action': { params: ActionEnvelope };
	'root/sessionAdded': { params: SessionAddedParams };
	'root/sessionRemoved': { params: SessionRemovedParams };
	'root/sessionSummaryChanged': { params: SessionSummaryChangedParams };
	'root/progress': { params: ProgressParams };
	'auth/required': { params: AuthRequiredParams };
	'otlp/exportLogs': { params: OtlpExportLogsParams };
	'otlp/exportTraces': { params: OtlpExportTracesParams };
	'otlp/exportMetrics': { params: OtlpExportMetricsParams };
}


export type AhpRequest<M extends keyof CommandMap = keyof CommandMap> =
	M extends unknown ? {
		readonly jsonrpc: '2.0';
		readonly id: number;
		readonly method: M;
		readonly params: CommandMap[M]['params'];
	} : never;

export type AhpServerRequest<M extends keyof ServerCommandMap = keyof ServerCommandMap> =
	M extends unknown ? {
		readonly jsonrpc: '2.0';
		readonly id: number;
		readonly method: M;
		readonly params: ServerCommandMap[M]['params'];
	} : never;


export type AhpSuccessResponse<M extends keyof CommandMap = keyof CommandMap> =
	M extends unknown ? {
		readonly jsonrpc: '2.0';
		readonly id: number;
		readonly result: CommandMap[M]['result'];
	} : never;

export type AhpResponse<M extends keyof CommandMap = keyof CommandMap> =
	| AhpSuccessResponse<M>
	| JsonRpcErrorResponse;

export type AhpServerSuccessResponse<M extends keyof ServerCommandMap = keyof ServerCommandMap> =
	M extends unknown ? {
		readonly jsonrpc: '2.0';
		readonly id: number;
		readonly result: ServerCommandMap[M]['result'];
	} : never;

export type AhpServerResponse<M extends keyof ServerCommandMap = keyof ServerCommandMap> =
	| AhpServerSuccessResponse<M>
	| JsonRpcErrorResponse;


export type AhpClientNotification<M extends keyof ClientNotificationMap = keyof ClientNotificationMap> =
	M extends unknown ? {
		readonly jsonrpc: '2.0';
		readonly method: M;
		readonly params: ClientNotificationMap[M]['params'];
	} : never;

export type AhpServerNotification<M extends keyof ServerNotificationMap = keyof ServerNotificationMap> =
	M extends unknown ? {
		readonly jsonrpc: '2.0';
		readonly method: M;
		readonly params: ServerNotificationMap[M]['params'];
	} : never;

export type AhpNotification = AhpClientNotification | AhpServerNotification;


export type ProtocolMessage =
	| AhpRequest
	| AhpServerRequest
	| AhpSuccessResponse
	| AhpServerSuccessResponse
	| JsonRpcErrorResponse
	| AhpNotification;
